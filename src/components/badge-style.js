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
 *
 * A badge carrying `action` is a button rather than a picture, so it needs the
 * states a control has. Both are drawn on the icon, not on `:host`: a page rule
 * outranks a `:host` rule, and nothing the page writes can reach inside the
 * shadow root. The chip is a box-shadow spread rather than padding, so growing
 * it on hover cannot reflow the headline it sits in.
 */

/** The badge styles, as text, so a `<style>` node can carry them where a constructable sheet cannot. */
export const BADGE_CSS = `
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

:host([action]) {
    cursor: pointer;
}

.badge-icon {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    min-width: 16px;
    min-height: 16px;
    flex-shrink: 0;
}

:host([action]) .badge-icon {
    border-radius: 50%;
    transition: background-color 120ms ease, box-shadow 120ms ease;
}

:host([action]:hover) .badge-icon,
:host([action]:focus-visible) .badge-icon {
    background-color: color-mix(in srgb, currentColor 18%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
}

/* The ring the keyboard needs. The host's own outline goes, because a page's blanket
   \`outline: none\` could take it away and leave a focused badge with no ring at all. */
:host([action]:focus-visible) .badge-icon {
    outline: 2px solid currentColor;
    outline-offset: 3px;
}

:host([action]:focus-visible) {
    outline: none;
}

@media (prefers-reduced-motion: reduce) {
    :host([action]) .badge-icon {
        transition: none;
    }
}

.badge-glyph-font {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-weight: 800;
    font-size: 11px;
}
`;

/** Built on first use, and only where it can be: see `adoptBadgeStyles`. */
let sharedSheet = null;

/**
 * Put the badge styles into `shadow`.
 *
 * One constructable sheet parsed once and shared by every badge is what a news page wants, since it
 * can carry dozens. A content script cannot have that in Firefox: the sheet belongs to the page's
 * realm and assigning one across the Xray boundary throws, so a `<style>` node carries the same text
 * there. Chromium takes the shared sheet in either world.
 *
 * @param {ShadowRoot} shadow
 */
export function adoptBadgeStyles(shadow) {
    try {
        if (!sharedSheet) {
            sharedSheet = new CSSStyleSheet();
            sharedSheet.replaceSync(BADGE_CSS);
        }
        shadow.adoptedStyleSheets = [sharedSheet];
        return;
    } catch {
        // Firefox, from a content script. The <style> node below is the same rules, per instance.
        sharedSheet = null;
    }

    const style = document.createElement("style");
    style.textContent = BADGE_CSS;
    shadow.appendChild(style);
}
