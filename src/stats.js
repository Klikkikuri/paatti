"use strict";

/**
 * @module stats
 *
 * Statistics module for Klikkikuri.
 *
 * ## How statistics operate
 *
 * There are two distinct categories of statistics managed by the extension:
 *
 * ### 1. Page Snapshot (live, per-tab)
 * Built from the `reasons` array produced by `processSite` in `contentScript.js`
 * after each conversion run. Represents the clickbaitiness distribution currently
 * present on the active page.
 * - Never persisted to storage directly (avoids tab race conditions and state leakage).
 * - Pushed to the popup via the `paatti-popup-direct` port as an event `pageStatsUpdated`.
 * - Used to render the gauge meter and the per-level breakdown list on the Home view.
 * - Levels with a count of 0 are hidden from the Home view list.
 *
 * ### 2. Cumulative Statistics (persistent, per siteConfig domain)
 * Accumulated in `browser.storage.local` under the key `statistics`.
 * Structure:
 * ```json
 * {
 *   "yle.fi": {
 *     "groupedByClickbaitiness": {
 *       "Extremely Clickbaity": 12,
 *       "Very Clickbaity": 8
 *     },
 *     "convertedCount": 15
 *   },
 *   "_global": {
 *     "totalConversions": 42
 *   }
 * }
 * ```
 * - Keyed by the canonical `siteConfig` domain (from `model.read.getMatchingSiteDomain`),
 *   rather than arbitrary subdomains / raw hostnames.
 * - Written at most once per unique article element per page-load session (guarded by
 *   `SessionTracker`), preventing dynamic DOM mutation re-scans from inflating counts.
 * - `groupedByClickbaitiness` counts every title found in the database, whether or not it was
 *   converted; titles under the threshold, on a disabled site, or without a replacement land in
 *   it too. `convertedCount` tallies only the titles actually swapped on the page, so the two
 *   are not expected to agree.
 * - `_global.totalConversions` is the same converted tally across every domain, for future
 *   aggregate milestones.
 * - Used to render the historical summary table on the Stats view.
 *
 * ## Data Flow Diagram
 *
 *   processSite (contentScript.js)
 *     ├─► buildPageSnapshot(reasons)          ──► Pushed to popup port (Home View)
 *     └─► sessionTracker.getDelta(reasons)    ──► mergeStats() ──► addStatistics() (Stats View)
 *
 * ## Module Boundaries
 * All exported functions in this module are pure or state-contained factory functions,
 * maintaining zero direct dependency on browser APIs, storage engines, or the DOM.
 */


/**
 * Numeric weight assigned to each clickbaitiness level for gauge calculation.
 * Must be kept in sync with Clickbaitiness.LEVELS in model.js.
 * @type {Object.<string, number>}
 */
const LEVEL_VALUES = {
    "Not Clickbait at all": 0,
    "Slightly Clickbaity":  1,
    "Moderately Clickbaity": 2,
    "Very Clickbaity":      3,
    "Extremely Clickbaity": 4,
};

/**
 * @typedef {Object.<string, number>} ClickbaitinessMap
 * Map of clickbaitiness level names to their occurrence counts.
 */

/**
 * @typedef {Object} PageSnapshot
 * @property {ClickbaitinessMap} groupedByClickbaitiness - Counts per clickbaitiness level.
 * @property {number} convertedCount - Number of elements with status 'converted'.
 */

/**
 * @typedef {Object} CumulativeStats
 * @property {ClickbaitinessMap} groupedByClickbaitiness - Aggregated historical counts per level.
 * @property {number} convertedCount - Aggregated number of titles actually converted.
 * @property {{ totalConversions: number }} [_global] - Global tally across all sites.
 */

/**
 * Builds a page snapshot object from a processSite reasons array.
 *
 * @param {Array<{ what: string, clickbaitiness?: string|null }>} reasons - Array of conversion results.
 * @returns {PageSnapshot} Aggregated page statistics snapshot.
 */
function buildPageSnapshot(reasons) {
    const groupedByClickbaitiness = {};
    let convertedCount = 0;

    if (Array.isArray(reasons)) {
        for (const item of reasons) {
            if (!item) continue;
            if (item.what === "converted") {
                convertedCount++;
            }
            if (item.clickbaitiness != null && item.clickbaitiness !== "") {
                groupedByClickbaitiness[item.clickbaitiness] =
                    (groupedByClickbaitiness[item.clickbaitiness] || 0) + 1;
            }
        }
    }

    return { groupedByClickbaitiness, convertedCount };
}

/**
 * Computes gauge visualization values from a clickbaitiness count mapping.
 *
 * @param {ClickbaitinessMap} groupedByClickbaitiness - Distribution of clickbaitiness levels.
 * @returns {{ averageValue: number, percentage: number, labelI18nKey: string }} Calculated gauge values and i18n label.
 */
function computeGaugeValue(groupedByClickbaitiness) {

    let totalCount = 0;
    let totalValue = 0;
    for (const [level, count] of Object.entries(groupedByClickbaitiness || {})) {
        const val = LEVEL_VALUES[level];
        if (val !== undefined && typeof count === "number") {
            totalCount += count;
            totalValue += count * val;
        }
    }

    const averageValue = totalCount > 0 ? totalValue / totalCount : 0;
    const percentage = Math.round((averageValue / 4) * 100);

    let labelI18nKey = "";
    if (averageValue < 0.5) {
        labelI18nKey = "clickbaitinessLabel_Not_Clickbait_at_all";
    } else if (averageValue < 1.5) {
        labelI18nKey = "clickbaitinessLabel_Slightly_Clickbaity";
    } else if (averageValue < 2.5) {
        labelI18nKey = "clickbaitinessLabel_Moderately_Clickbaity";
    } else if (averageValue < 3.5) {
        labelI18nKey = "clickbaitinessLabel_Very_Clickbaity";
    } else {
        labelI18nKey = "clickbaitinessLabel_Extremely_Clickbaity";
    }

    return { averageValue, percentage, labelI18nKey };
}

/**
 * Merges an incoming page delta into existing cumulative statistics.
 * Pure function that does not mutate inputs.
 *
 * @param {CumulativeStats} [existing={}] - Existing cumulative statistics object for the domain.
 * @param {PageSnapshot} [incoming={}] - Incoming delta snapshot to merge.
 * @returns {CumulativeStats} Newly merged cumulative statistics object.
 */
function mergeStats(existing = {}, incoming = {}) {
    const merged = {
        groupedByClickbaitiness: { ...(existing.groupedByClickbaitiness || {}) },
        convertedCount: (existing.convertedCount || 0) + (incoming.convertedCount || 0)
    };

    for (const [level, count] of Object.entries(incoming.groupedByClickbaitiness || {})) {
        if (typeof count === "number") {
            merged.groupedByClickbaitiness[level] =
                (merged.groupedByClickbaitiness[level] || 0) + count;
        }
    }

    return merged;
}

/**
 * Creates a session tracker to prevent counting duplicate elements across multiple conversion passes.
 * Uses the element's URL signature, original title, or rendered text as the identity key.
 *
 * @returns {{ getDelta: (reasons: Array<{ urlSign?: string, originalTitle?: string, how?: string, what: string, clickbaitiness?: string|null }>) => Array }}
 */
function createSessionTracker() {
    const seen = new Set();

    return {
        /**
         * Filters the reasons array down to elements not yet observed during this session.
         * @param {Array<{ urlSign?: string, originalTitle?: string, how?: string, what: string, clickbaitiness?: string|null }>} reasons
         * @returns {Array} Unseen reason objects for delta calculation.
         */
        getDelta(reasons) {
            if (!Array.isArray(reasons)) return [];
            const delta = [];
            for (const reason of reasons) {
                if (!reason) continue;
                const key = reason.urlSign || reason.originalTitle || reason.how;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                delta.push(reason);
            }
            return delta;
        }
    };
}

export {
    buildPageSnapshot,
    computeGaugeValue,
    mergeStats,
    createSessionTracker
};
