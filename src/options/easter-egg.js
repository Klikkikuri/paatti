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
 * @param {number} params.roll - Random number in [0, 1).
 * @returns {boolean}
 */
function shouldShowEasterEgg({ probability, roll }) {
    const chance = Number(probability);
    if (!Number.isFinite(chance) || chance <= 0) return false;

    return roll < chance;
}

export { shouldShowEasterEgg };
