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
 *     "convertedByClickbaitiness": {
 *       "Extremely Clickbaity": 9
 *     },
 *     "firstSeen": 1755000000000
 *   }
 * }
 * ```
 * - Keyed by the canonical `siteConfig` domain (from `model.read.getMatchingSiteDomain`),
 *   rather than arbitrary subdomains / raw hostnames.
 * - Written at most once per unique article element per page-load session (guarded by
 *   `SessionTracker`), preventing dynamic DOM mutation re-scans from inflating counts.
 * - `groupedByClickbaitiness` counts every title found in the database, whether or not it was
 *   converted; titles under the threshold, on a disabled site, or without a replacement land in
 *   it too.
 * - `convertedByClickbaitiness` is the swapped subset of it, level by level, and the whole record
 *   of what was rewritten: nothing is swapped below the threshold, so nothing is swapped without a
 *   level, and a total is always a sum over these. Within a level the swapped titles are a subset
 *   of the found ones, so a share between the two is real wherever it is stated.
 * - Records written before the split existed carry no swapped counts, and no later write can
 *   divide their history into levels: they keep their found counts and read zero rewritten.
 * - `firstSeen` is stamped on the first write for the domain and never moves after that, so the
 *   Stats view can say how long the tally took to build. Records written before the field existed
 *   get it on their next write, which starts their period short.
 * - Used to render the historical summary table on the popup's Stats view, and — every domain at
 *   once, through `summarizeSites` — the totals section on the options page.
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
 * @property {ClickbaitinessMap} convertedByClickbaitiness - Counts per level of the ones converted.
 */

/**
 * @typedef {Object} CumulativeStats
 * @property {ClickbaitinessMap} groupedByClickbaitiness - Aggregated historical counts per level.
 * @property {ClickbaitinessMap} convertedByClickbaitiness - Aggregated historical counts per level
 *   of the titles actually converted.
 * @property {number} [firstSeen] - Epoch ms of the first write for this domain. Absent on records
 *   stored before the field existed, until their next write.
 */

/**
 * Builds a page snapshot object from a processSite reasons array.
 *
 * @param {Array<{ what: string, clickbaitiness?: string|null }>} reasons - Array of conversion results.
 * @returns {PageSnapshot} Aggregated page statistics snapshot.
 */
function buildPageSnapshot(reasons) {
    const groupedByClickbaitiness = {};
    const convertedByClickbaitiness = {};

    if (Array.isArray(reasons)) {
        for (const item of reasons) {
            if (!item) continue;
            const wasConverted = item.what === "converted";
            if (item.clickbaitiness != null && item.clickbaitiness !== "") {
                groupedByClickbaitiness[item.clickbaitiness] =
                    (groupedByClickbaitiness[item.clickbaitiness] || 0) + 1;
                if (wasConverted) {
                    convertedByClickbaitiness[item.clickbaitiness] =
                        (convertedByClickbaitiness[item.clickbaitiness] || 0) + 1;
                }
            }
        }
    }

    return { groupedByClickbaitiness, convertedByClickbaitiness };
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
 * @param {number} [now=Date.now()] - Epoch ms to stamp a first write with.
 * @returns {CumulativeStats} Newly merged cumulative statistics object.
 */
function mergeStats(existing = {}, incoming = {}, now = Date.now()) {
    const merged = {
        groupedByClickbaitiness: { ...(existing.groupedByClickbaitiness || {}) },
        convertedByClickbaitiness: { ...(existing.convertedByClickbaitiness || {}) },
        firstSeen: existing.firstSeen ?? now
    };

    for (const [level, count] of Object.entries(incoming.groupedByClickbaitiness || {})) {
        if (typeof count === "number") {
            merged.groupedByClickbaitiness[level] =
                (merged.groupedByClickbaitiness[level] || 0) + count;
        }
    }

    for (const [level, count] of Object.entries(incoming.convertedByClickbaitiness || {})) {
        if (typeof count === "number") {
            merged.convertedByClickbaitiness[level] =
                (merged.convertedByClickbaitiness[level] || 0) + count;
        }
    }

    return merged;
}

/**
 * @typedef {Object} LevelSummary
 * @property {string} level - The clickbaitiness level name.
 * @property {number} index - Its position in the levels list, i.e. its severity.
 * @property {number} count - Titles found at this level.
 * @property {number} rewritten - How many of those were actually converted.
 */

/**
 * Reduces a tally to the levels worth a row, and measures the scale those rows are drawn against.
 *
 * `maxCount` is the largest count among the shown levels rather than the total, so a bar shows a
 * level against the busiest level, not against a sum it can never approach.
 *
 * The two totals sum every level, the empty ones included, so a caller can state what a tally comes
 * to without counting the maps a second time.
 *
 * @param {ClickbaitinessMap} [groupedByClickbaitiness] - Titles found per level.
 * @param {ClickbaitinessMap} [convertedByClickbaitiness] - Titles converted per level.
 * @param {string[]} [levels] - Level names, in severity order; the output follows it.
 * @returns {{ shown: LevelSummary[], maxCount: number, totalFound: number, totalRewritten: number }}
 */
function summarizeLevels(groupedByClickbaitiness, convertedByClickbaitiness, levels = []) {
    const found = groupedByClickbaitiness || {};
    const converted = convertedByClickbaitiness || {};

    const shown = [];
    let maxCount = 0;
    let totalFound = 0;
    let totalRewritten = 0;

    levels.forEach((level, index) => {
        const count = found[level] || 0;
        const rewritten = converted[level] || 0;
        totalFound += count;
        totalRewritten += rewritten;

        if (count > 0) {
            shown.push({ level, index, count, rewritten });
            maxCount = Math.max(maxCount, count);
        }
    });

    return { shown, maxCount, totalFound, totalRewritten };
}

/**
 * A sibling of the domain records that older versions kept a cross-domain tally under. Nothing
 * writes it now, but a stored map can still carry one, and it is not a site.
 */
const GLOBAL_KEY = "_global";

/**
 * A part as a whole-number percentage of its whole, or null where there is no whole to be a part
 * of. Every caller counts its part out of the whole it passes, so the two always belong together.
 *
 * @param {number} part
 * @param {number} whole
 * @returns {number|null}
 */
function sharePercent(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * @typedef {Object} Reading
 * @property {number} percentage - How clickbaity the tally reads, 0..100.
 * @property {number} severity - The same reading as a level index, 0..4, for colouring.
 * @property {string} labelI18nKey - Message key naming the reading.
 */

/**
 * The gauge reading for a tally, in the shape a view needs it.
 *
 * The gauge bands on the same boundaries rounding does, so `severity` indexes the level whose
 * label `computeGaugeValue` just chose; the colour and the words can never disagree.
 *
 * @param {ClickbaitinessMap} groupedByClickbaitiness
 * @returns {Reading}
 */
function readingFor(groupedByClickbaitiness) {
    const { averageValue, percentage, labelI18nKey } = computeGaugeValue(groupedByClickbaitiness);

    return { percentage, severity: Math.round(averageValue), labelI18nKey };
}

/**
 * @typedef {Reading} SiteSummary
 * @property {string} domain - The siteConfig domain the record is keyed by.
 * @property {number} found - Titles found on the site, over every level the gauge knows.
 * @property {number} rewritten - Titles actually swapped there.
 * @property {number} sharePercent - `rewritten` as a percentage of `found`. Always there to state:
 *   a record with nothing found is not a row.
 * @property {ClickbaitinessMap} foundByLevel - The titles behind `found`, level by level, as stored.
 * @property {ClickbaitinessMap} rewrittenByLevel - The swapped subset of them, level by level.
 * @property {number} [firstSeen] - Epoch ms collection started for the domain.
 */

/**
 * Reduces the whole statistics map to one row per domain, plus the reading across all of them,
 * for the options page totals.
 *
 * `overallByLevel` pools every domain's levels together, so a site read a thousand times weighs
 * more in it than one read twice. It is what you were served, level by level, rather than an
 * average over it: a view states the mix from it, and `summarizeLevels` is what orders and scales
 * it. Empty until something has been found somewhere.
 *
 * `clickbaitiest` needs at least two sites with titles found — an award over a single candidate
 * states nothing about it — and is decided on the gauge reading, ties going to the site with more
 * titles behind that reading.
 *
 * `rewritten` and `found` are counted over the same levels of the same record, so the share between
 * them always holds: a level too old to weigh drops out of both, and within a level the swapped
 * titles are a subset of the found ones.
 *
 * @param {Object.<string, CumulativeStats>} [statistics] - The stored map, `_global` included.
 * `totals` pools the rows the same way, so the headline states what the table sums to. It is not
 * taken from `_global.totalConversions`: that was accumulated beside the per-domain records and
 * reaches further back than they do, so setting it against the found total would put two stretches
 * of history on either side of one "of". Nothing has written it for some versions now.
 *
 * `since` is the earliest start any record carries, so the section can say how far back the whole
 * tally reaches. Records stored before `firstSeen` existed have none until their next write, and
 * are simply not candidates for it.
 *
 * A row also carries its record's two level maps untouched, so a view can break the row down with
 * `summarizeLevels`. They are passed on rather than read here: naming the levels would need their
 * order, and that is what would tie this module to `model.js`.
 *
 * @returns {{ sites: SiteSummary[], clickbaitiest: SiteSummary|null,
 *   overallByLevel: ClickbaitinessMap,
 *   totals: { rewritten: number, found: number, sharePercent: number|null }, since: number|null }}
 */
function summarizeSites(statistics) {
    const sites = [];
    const pooled = {};
    let pooledFound = 0;
    let pooledRewritten = 0;
    let since = null;

    for (const [domain, record] of Object.entries(statistics || {})) {
        if (domain === GLOBAL_KEY || !record) continue;

        const grouped = record.groupedByClickbaitiness || {};
        const rewrittenByLevel = record.convertedByClickbaitiness || {};
        let found = 0;
        let rewritten = 0;
        for (const [level, count] of Object.entries(grouped)) {
            // A level the gauge cannot weigh is one no view names either, so it stays out of both
            // totals: the row's tallies, its reading and its breakdown then count the same titles,
            // whatever a backend one day stores beside the levels known here.
            if (typeof count !== "number" || LEVEL_VALUES[level] === undefined) continue;

            found += count;
            pooled[level] = (pooled[level] || 0) + count;

            const swapped = rewrittenByLevel[level];
            if (typeof swapped === "number") rewritten += swapped;
        }

        // A domain the tracker has touched but never counted anything on is not a row. Records
        // predating the split are rows on their found counts alone, reading zero rewritten.
        if (found === 0) continue;

        sites.push({
            domain, found, rewritten,
            sharePercent: sharePercent(rewritten, found),
            // References into the record rather than copies; nothing here writes through them.
            foundByLevel: grouped,
            rewrittenByLevel,
            firstSeen: record.firstSeen,
            ...readingFor(grouped)
        });
        pooledFound += found;
        pooledRewritten += rewritten;

        if (Number.isFinite(record.firstSeen) && (since === null || record.firstSeen < since)) {
            since = record.firstSeen;
        }
    }

    // Busiest first, and the domain as the last key so the order cannot shuffle between renders.
    sites.sort((a, b) => b.rewritten - a.rewritten || b.found - a.found || a.domain.localeCompare(b.domain));

    const candidates = sites.filter((site) => site.found > 0);
    const clickbaitiest = candidates.length >= 2
        ? candidates.reduce((worst, site) =>
            (site.percentage > worst.percentage || (site.percentage === worst.percentage && site.found > worst.found))
                ? site
                : worst)
        : null;

    return {
        sites,
        clickbaitiest,
        overallByLevel: pooled,
        totals: {
            rewritten: pooledRewritten,
            found: pooledFound,
            sharePercent: sharePercent(pooledRewritten, pooledFound)
        },
        since
    };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar months between two dates, in local time so the count follows the user's own
 * calendar. Calendar months rather than 30-day blocks keep "3 months" the same span across February.
 *
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
function countCalendarMonths(from, to) {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    return to.getDate() < from.getDate() ? months - 1 : months;
}

/**
 * @typedef {Object} CollectingPeriod
 * @property {number} count - Amount of the chosen unit.
 * @property {string} labelI18nKey - Message key naming the unit; takes the count as its substitution.
 */

/**
 * Describes how long statistics have been collected, on a scale that stays legible as it grows:
 * days, then weeks, then months, then years.
 *
 * A unit holds until its count passes roughly a dozen, and a coarser unit is taken up only once
 * there are several of it — "10 weeks" says more than "2 months", "14 months" more than "1 year".
 * No rung can therefore report a count of 1 except days, which is why only days need a singular
 * message.
 *
 * @param {number} [firstSeen] - Epoch ms collection started.
 * @param {number} [now=Date.now()] - Epoch ms to measure to.
 * @returns {CollectingPeriod|null} Null when no start time is recorded.
 */
function computeCollectingPeriod(firstSeen, now = Date.now()) {
    if (!Number.isFinite(firstSeen)) return null;

    const days = Math.floor((now - firstSeen) / MS_PER_DAY);
    const months = countCalendarMonths(new Date(firstSeen), new Date(now));

    if (days < 1) return { count: 0, labelI18nKey: "statsviewCollectingPeriodToday" };
    // Months rank above days so that 70 days, which is two calendar months, still reads "10 weeks".
    if (months >= 18) return { count: Math.round(months / 12), labelI18nKey: "statsviewCollectingPeriodYears" };
    if (months >= 3) return { count: months, labelI18nKey: "statsviewCollectingPeriodMonths" };
    if (days >= 14) return { count: Math.round(days / 7), labelI18nKey: "statsviewCollectingPeriodWeeks" };
    if (days >= 2) return { count: days, labelI18nKey: "statsviewCollectingPeriodDays" };
    return { count: 1, labelI18nKey: "statsviewCollectingPeriodDay" };
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
    GLOBAL_KEY,
    buildPageSnapshot,
    computeGaugeValue,
    computeCollectingPeriod,
    mergeStats,
    sharePercent,
    summarizeLevels,
    summarizeSites,
    createSessionTracker
};
