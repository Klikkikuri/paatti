"use strict";

/**
 * The slides of the setup wizard, the flow of a mode, and the rules for moving between them. DOM-free, so
 * `make test` covers it.
 *
 * Two lists, with different jobs:
 * - The deck is every slide of the document, in order. Both modes show the same deck.
 * - The flow is the deck indices that Next, Back, a segment and the arrow keys walk. The tour walks every
 *   slide; the quick flow leaves out the tour-only slides, which a reader can still scroll to by hand.
 *
 * The current index always indexes the deck, so it can name a slide that is outside the flow. Every rule below
 * takes a deck index for that reason, and the page keeps one index through the navigator.
 *
 * A slide is addressed by the fragment `#slide-<id>`, which is also the id of its section. The browser
 * therefore scrolls to the slide before any script runs.
 */

/** Every slide, in order. A `tourOnly` slide is outside the quick flow. The titles come from `_locales`. */
export const SLIDES = Object.freeze([
    { id: "welcome", tourOnly: false },
    { id: "service", tourOnly: true },
    { id: "browser", tourOnly: true },
    { id: "strictness", tourOnly: false },
    { id: "markers", tourOnly: false },
    { id: "sites", tourOnly: false },
    { id: "popup", tourOnly: true },
    { id: "wrong", tourOnly: true },
    { id: "ready", tourOnly: false },
]);

/** Every slide id, in document order. */
export const slideIds = () => SLIDES.map(({ id }) => id);

/**
 * @param {string} mode - "quick" or "tour".
 * @returns {string[]} The slide ids that Next and Back walk, in order.
 */
export const flowIds = (mode) => (mode === "tour" ? slideIds() : SLIDES.filter((slide) => !slide.tourOnly).map(({ id }) => id));

/** @returns {number} `index`, inside `0 … count - 1`. */
export const clampIndex = (count, index) => Math.min(Math.max(index, 0), count - 1);

/**
 * @param {string[]} ids - Slide ids, in document order.
 * @param {string} hash - The fragment, with or without the leading "#".
 * @returns {number} The index, or -1 when the fragment names no slide.
 */
export const indexOfFragment = (ids, hash) => (hash.startsWith("#slide-") ? ids.indexOf(hash.slice("#slide-".length)) : -1);

/**
 * @param {string[]} ids - Slide ids, in document order.
 * @param {number} index - A deck index.
 * @returns {string} The fragment that names the slide at `index`.
 */
export const fragmentOf = (ids, index) => `#slide-${ids[index]}`;

/**
 * The nearest flow index after `index`. Both ends of the deck are handled by the null, so a slide that is
 * outside the flow still has a correct next slide.
 *
 * @param {number[]} flow - Indices into the deck, in order.
 * @param {number} index - The current deck index.
 * @returns {number|null} The next flow index, or null at the end.
 */
export const nextInFlow = (flow, index) => flow.find((step) => step > index) ?? null;

/**
 * The nearest flow index before `index`. See `nextInFlow`.
 *
 * @param {number[]} flow - Indices into the deck, in order.
 * @param {number} index - The current deck index.
 * @returns {number|null} The previous flow index, or null at the start.
 */
export const previousInFlow = (flow, index) => flow.filter((step) => step < index).at(-1) ?? null;

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
 * The start index is given, not reported: `onChange` runs only for a change after that. A page that starts on
 * the slide of its address therefore draws once without a false report of a move.
 *
 * A move that the code starts (a button, a segment) sets the index at once and locks it: the scroll that follows
 * passes through the slides in between, and they must not become current on the way. `settled` ends the lock.
 *
 * @param {object} options
 * @param {number} options.count - How many slides the deck has.
 * @param {number} [options.initial] - The index that the page starts on. Defaults to the first slide.
 * @param {(index: number) => void} options.onChange - Called when the index changes, not otherwise.
 */
export function createNavigator({ count, initial = 0, onChange }) {
    let index = clampIndex(count, initial);
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
            const chosen = clampIndex(count, target);
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
