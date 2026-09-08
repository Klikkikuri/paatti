"use strict";

/**
 * @file home-status.js
 * What the popup's home view says, and which of its two actions it offers.
 *
 * Kept apart from popup.js and free of the DOM so the precedence can be read and tested on its own.
 * It returns i18n keys and never resolved text, which keeps the `browser` namespace out of here too.
 *
 * The order of the branches is the contract, not an implementation detail: several inputs can be
 * unhappy at once, and the one named first is the one the user can act on. The test asserts it.
 */

/**
 * @typedef {Object} HomeStatus
 * @property {string} statusKey - i18n key for the status line, or "" to leave it blank.
 * @property {?string} headerKey - i18n key replacing the hostname in the header, or null to keep it.
 * @property {boolean} isError - Whether the header wears the error colour.
 * @property {boolean} showCompanion - Whether the companion artwork is drawn under the message
 *   -- the boat by day, the meerman after dark. It marks the two states that have nothing to
 *   report yet rather than something to report.
 * @property {boolean} showGauge - Whether the gauge and its per-level list are shown.
 * @property {boolean} showRequestSite - Whether the "request site support" button is shown.
 * @property {boolean} showUpdateDb - Whether the database update control is shown.
 */

const state = (statusKey, { headerKey = null, isError = false, showCompanion = false,
    showGauge = false, showRequestSite = false, showUpdateDb = false } = {}) =>
    ({ statusKey, headerKey, isError, showCompanion, showGauge, showRequestSite, showUpdateDb });

/**
 * Decides what the home view shows for the current page and extension state.
 *
 * @param {Object} input
 * @param {boolean} [input.loadFailed] - The popup could not read its own data.
 * @param {boolean} [input.hasHostname] - The active tab has a hostname; false on about: pages.
 * @param {boolean} [input.isSupported] - A siteConfig matches the hostname.
 * @param {boolean} [input.isEnabled] - That siteConfig is on and holds its host permission.
 * @param {boolean} [input.conversionEnabled] - The master switch is on.
 * @param {boolean} [input.databaseEmpty] - The local title database holds no entries.
 * @param {?import('../stats.js').PageSnapshot} [input.pageStats] - Live snapshot, null until the
 *   content script pushes one.
 * @param {boolean} [input.waited] - The grace period for that first push has passed.
 * @returns {HomeStatus}
 */
function homeStatus({ loadFailed, hasHostname, isSupported, isEnabled, conversionEnabled,
    databaseEmpty, pageStats, waited } = {}) {

    if (loadFailed) {
        return state("homeviewStatusLoadFailed", { isError: true });
    }

    // No hostname means an about: or file: tab. Same dead end as an unsupported site, but there is
    // nothing to name in a site request, so the button that files one stays away.
    if (!hasHostname) {
        return state("homeviewStatusNotSupported", {
            headerKey: "siteTitleProcessingNotSupported", isError: true, showCompanion: true });
    }

    if (!isSupported) {
        return state("homeviewStatusNotSupported", {
            headerKey: "siteTitleProcessingNotSupported", isError: true, showCompanion: true,
            showRequestSite: true });
    }

    // The master switch outranks the per-site one: turning the site on would change nothing.
    if (!conversionEnabled) {
        return state("homeviewStatusExtensionOff", {
            headerKey: "siteTitleProcessingDisabled", isError: true });
    }

    if (!isEnabled) {
        return state("homeviewStatusDisabled", {
            headerKey: "siteTitleProcessingDisabled", isError: true });
    }

    // Above the page-stats branches on purpose. On a fresh install the database is empty *and* the
    // content script has usually not pushed yet; "reload the page" would send the user off to fix
    // the wrong thing. An empty database is a definite fault with a button attached.
    if (databaseEmpty) {
        return state("homeviewStatusDatabaseEmpty", { showUpdateDb: true });
    }

    if (!pageStats) {
        // The first push waits on a round trip to the background worker, so a popup opened on a
        // healthy page sits here for a moment. Say that Paatti is working until the grace period
        // is spent, and only then treat the silence as a fault.
        return waited
            ? state("homeviewStatusNoPageData")
            : state("homeviewStatusChecking", { showCompanion: true });
    }

    // An ordinary article page carries no headline links, which is not a fault of anything.
    if (!pageStats.candidates) {
        return state("homeviewStatusNoTitlesFound");
    }

    if (Object.keys(pageStats.groupedByClickbaitiness || {}).length === 0) {
        return state("homeviewStatusNoMatches");
    }

    return state("", { showGauge: true });
}

export { homeStatus };
