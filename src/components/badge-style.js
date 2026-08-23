"use strict";

/**
 * Shared shadow DOM styling for in-page badges.
 *
 * Badges carry no colours of their own. The icon body is painted with
 * `currentColor`, so it inherits the headline's colour, and the glyph inside it
 * is knocked out (see `knockoutMask`) so the page's own background shows
 * through. A badge is therefore correct on any site, in any theme, without
 * inspecting the page at all.
 *
 * This is why badges must NOT use `prefers-color-scheme`: that reports the OS
 * preference, while injected content lives in the page's theme. A dark site on
 * a light-mode OS would otherwise get a black badge on a dark headline.
 */

/**
 * The badge stylesheet, parsed once and adopted by every badge's shadow root
 * rather than injected as a `<style>` element per instance.
 *
 * Constructable stylesheets need Chrome 73 / Firefox 101; the manifest already
 * requires far newer than that.
 *
 * @type {CSSStyleSheet}
 */
export const badgeStyleSheet = new CSSStyleSheet();

badgeStyleSheet.replaceSync(`
:host {
    /* No colour declaration here on purpose: inherit it from the headline. */
    display: inline-flex !important;
    align-items: center;
    vertical-align: middle;
    margin-right: 0.35em;
    font-size: 0.85em;
    line-height: 1;
    user-select: none;
}

.badge-icon {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    min-width: 16px;
    min-height: 16px;
    flex-shrink: 0;
}

.badge-glyph-font {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-weight: 800;
    font-size: 11px;
}
`);

/**
 * Build an SVG `<mask>` that cuts `glyph` out of `body`.
 *
 * Everything white in a luminance mask is painted, everything black is removed,
 * so drawing the glyph in black punches a hole through the badge body. Mask ids
 * only need to be unique within a shadow root, and every badge instance has its
 * own, so a fixed id is safe.
 *
 * @param {string} id - Mask id, referenced as `mask="url(#id)"`.
 * @param {string} body - Shape covering the badge, drawn in white.
 * @param {string} glyph - Shape to knock out, drawn in black.
 * @returns {string} `<defs>` markup containing the mask.
 */
export function knockoutMask(id, body, glyph) {
    return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
    <g fill="#ffffff">${body}</g>
    <g fill="#000000">${glyph}</g>
</mask></defs>`;
}
