"use strict";

/**
 * The slides of the setup wizard, and the rules for moving between them. DOM-free, so `make test` covers it.
 *
 * The page keeps one `currentIndex`. Next, Back, the step indicator and the scroll position all lead to it
 * through the navigator below, so they cannot disagree about which slide is current.
 */

/** Every slide, in order. A `tour` slide is only in the longer deck. The titles come from `_locales`. */
export const SLIDES = Object.freeze([
    { id: "strictness", tour: false },
    { id: "markers", tour: false },
    { id: "sites", tour: false },
    { id: "wrong", tour: true },
    { id: "corrections", tour: true },
    { id: "ready", tour: false },
]);

/**
 * @param {string} mode - "quick" or "tour".
 * @returns {Array<{id: string, tour: boolean}>} The slides of that mode, in order.
 */
export const buildDeck = (mode) => SLIDES.filter((slide) => mode === "tour" || !slide.tour);

/**
 * @param {string} search - The query string of the page address.
 * @returns {"quick"|"tour"} The mode, "quick" for a missing or unknown one.
 */
export const modeOf = (search) => (new URLSearchParams(search).get("mode") === "tour" ? "tour" : "quick");

/**
 * The slide that covers a horizontal line across the viewport. A slide can be taller than the viewport, so a
 * ratio of "how much is visible" would never be reached by it; a line is.
 *
 * @param {Array<{top: number, bottom: number}>} rects - One per slide, in order.
 * @param {number} line - Distance of the line from the top of the viewport.
 * @returns {number} The index, or -1 when no slide covers the line.
 */
export const slideAtLine = (rects, line) => rects.findIndex(({ top, bottom }) => top <= line && line < bottom);

/**
 * Keeps one current index for a deck.
 *
 * A move that the code starts (a button, a segment) sets the index at once and locks it: the scroll that follows
 * passes through the slides in between, and they must not become current on the way. `settled` ends the lock.
 *
 * @param {object} options
 * @param {number} options.count - How many slides the deck has.
 * @param {(index: number) => void} options.onChange - Called when the index changes, not otherwise.
 */
export function createNavigator({ count, onChange }) {
    let index = 0;
    let locked = false;

    const set = (next) => {
        if (next === index) return;
        index = next;
        onChange(index);
    };

    return {
        get index() { return index; },
        get isLocked() { return locked; },

        /** Go to a slide. Out-of-range values stop at the ends. @returns {number} The index that was chosen. */
        request(target) {
            const chosen = Math.min(Math.max(target, 0), count - 1);
            locked = true;
            set(chosen);
            return chosen;
        },

        /** The scroll position now shows this slide. Ignored while a move is running, and for -1. */
        scrolled(visible) {
            if (locked || visible < 0) return;
            set(visible);
        },

        /** The scroll of a move has ended, or its time has run out. */
        settled() {
            locked = false;
        },
    };
}
