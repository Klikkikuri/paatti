"use strict";

/**
 * Shared shadow DOM styling for in-page badges.
 *
 * Badges carry no colours of their own. The icon body is painted with
 * `currentColor`, so it inherits the headline's colour, and the glyph inside it
 * is knocked out -- each icon's own `<mask>` in assets/icons/ -- so the page's
 * own background shows through. A badge is therefore correct on any site, in any
 * theme, without inspecting the page at all.
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
