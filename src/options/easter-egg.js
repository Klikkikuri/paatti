"use strict";

/**
 * @file easter-egg.js
 * The rule behind the rare artwork the page background may show.
 *
 * Kept apart from the <page-background> component that uses it, and free of both
 * DOM and randomness, so the rule can be read and tested on its own.
 */

/**
 * Decide whether the easter egg shows on this roll.
 *
 * @param {Object} params
 * @param {boolean} params.isDark - True when the dark palette is active.
 * @param {number} params.probability - Chance of a sighting, 0..1.
 * @param {number} params.roll - Random number in [0, 1).
 * @returns {boolean}
 */
function shouldShowEasterEgg({ isDark, probability, roll }) {
    // Only the dark theme has artwork for her so far (--easter-egg-art in theme.css).
    // Drop this gate once a daylight counterpart exists.
    if (!isDark) return false;

    const chance = Number(probability);
    if (!Number.isFinite(chance) || chance <= 0) return false;

    return roll < chance;
}

export { shouldShowEasterEgg };
