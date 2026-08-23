"use strict";

/**
 * @file easter-egg.js
 * The rule behind the rare artwork the page background may show, the calendar of
 * days that always show it, and the test for a storage change that can move either.
 *
 * Kept apart from the <page-background> component that uses it, and free of both
 * DOM and randomness, so the rule can be read and tested on its own. The calendar
 * holds i18n keys and never resolved text, which keeps browser() out of here too.
 */

/**
 * Days the artwork always shows, whatever the odds, keyed by MM-DD and matched
 * every year. Kept in calendar order: a new day then has one obvious place to go,
 * and a repeated one is easy to see. The test asserts the order.
 */
const SPECIAL_DAYS = Object.freeze({
    '03-19': 'specialDayMinnaCanth',   // Minna Canth's Day
    '05-03': 'specialDayPressFreedom', // World Press Freedom Day
    '06-15': 'specialDayMagnaCarta',   // Magna Carta, 1215
    '06-20': 'specialDayJaws',         // Jaws, released 20.06.1975
    '07-10': 'specialDayKlikkikuri',   // Klikkikuri v0.0.1
    '07-17': 'specialDayDemocracyDay', // Finnish Democracy Day, the 1919 Constitution Act
    '08-14': 'specialDayJyu',          // JYU foundation
    '10-11': 'specialDayTaija',        // Taija
    '12-02': 'specialDayPressAct',     // Freedom of the Press Act, 1766
    '12-04': 'specialDayJuho',         // Juho
    '12-16': 'specialDayTeemu',        // Teemu
});

/**
 * The local calendar day of a date, as YYYY-MM-DD.
 *
 * Local and not toISOString(), which is UTC: a user east of Greenwich would get
 * yesterday's key through the first hours of their day, and the artwork would
 * change under them at an hour that means nothing.
 *
 * @param {Date} date - The day to name. The caller passes new Date().
 * @returns {string}
 */
function dayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

/**
 * Hash a string into a number in [0, 1): 32-bit FNV-1a, then an avalanche
 * finalizer.
 *
 * The finalizer is not decoration. Two neighbouring day keys differ in a single
 * character, and plain FNV-1a carries that small difference through to a small
 * difference in the result -- consecutive days would land beside each other in
 * [0, 1), so sightings would arrive in clumps. The finalizer mixes the low bits
 * back through the whole word, which scatters near-identical keys.
 *
 * @param {string} key - The string to hash.
 * @returns {number} A number in [0, 1).
 */
function unitHash(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }

    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;

    return (h >>> 0) / 4294967296;
}

/**
 * The i18n key that says what makes this day special, or null on an ordinary day.
 *
 * One table serves two callers: <page-background> only asks whether there is a
 * key, and the about page shows the message behind it.
 *
 * @param {Date} date - The day to look up.
 * @returns {?string} An i18n message key, or null.
 */
function specialDayMessageKey(date) {
    return SPECIAL_DAYS[dayKey(date).slice(5)] ?? null;
}

/**
 * Does this storage change carry a new easter egg probability?
 *
 * getConfig() merges the value from two places. The setter writes the sync
 * environmentConfigs, and that layer wins. Under it sits the local userPreferences,
 * which carries a lower-priority environmentConfigs of its own and the environment
 * key that settles which environment is read at all. Everything else -- statistics
 * above all, which are written constantly -- is none of this rule's business.
 *
 * @param {Object} changes - chrome.storage.onChanged changes.
 * @param {string} areaName - Storage area the change came from.
 * @returns {boolean}
 */
function affectsEasterEgg(changes, areaName) {
    if (areaName === 'sync') return Boolean(changes.environmentConfigs);
    if (areaName === 'local') return Boolean(changes.userPreferences);

    return false;
}

/**
 * Decide whether the easter egg shows on this roll.
 *
 * Which artwork appears, and where on the sea it sits, is settled by the rules in
 * components/page-background.css. Both themes have a piece, so nothing here cares
 * about light or dark.
 *
 * The caller is expected to hold one roll for the life of the page rather than
 * draw a fresh one per call. The answer is then a plain threshold at that roll:
 * raising the probability can reveal the artwork but never clear a sighting off
 * the screen, and asking twice over gives the same answer.
 *
 * @param {Object} params
 * @param {number} params.probability - Chance of a sighting, 0..1.
 * @param {number} params.roll - The day's number in [0, 1); see unitHash above.
 * @returns {boolean}
 */
function shouldShowEasterEgg({ probability, roll }) {
    const chance = Number(probability);
    if (!Number.isFinite(chance) || chance <= 0) return false;

    return roll < chance;
}

export { shouldShowEasterEgg, affectsEasterEgg, dayKey, unitHash, specialDayMessageKey, SPECIAL_DAYS };
