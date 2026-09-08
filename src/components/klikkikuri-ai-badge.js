"use strict";

import { createBadgeClass } from "./badge-base.js";

/**
 * Custom Web Component for EU-styled AI content badges.
 * Displays the official EU AI circle badge icon (solid circle with bold 'AI' cutout).
 *
 * The circle is painted with `currentColor` and the "AI" lettering is knocked
 * out of it, so the badge inherits the headline's colour and lets the page's
 * background show through the letters. See badge-style.js for why no explicit
 * light/dark colours are declared here.
 *
 * NOTE: A non-OSS variant of this file exists at
 * assets/non-oss/by-kagi/src/components/klikkikuri-ai-badge.js
 * which overrides this file in NON_OSS=1 builds. When modifying this file
 * (e.g. shared styles, component API, or custom element registration),
 * apply the same structural changes there as well.
 */

// @icon-source assets/icons/ai-badge.svg
// BEGIN GENERATED ICON -- edit the .svg, then run `make icons`
const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    <!-- The EU AI circle: solid disc in the headline's colour, with the lettering knocked out of
         it so the page's own background shows through. White paints the mask, black cuts it. -->
    <defs>
        <mask id="ai-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <circle cx="12" cy="12" r="11" fill="#ffffff" />
            <text class="badge-glyph-font" x="12" y="15.5" text-anchor="middle" fill="#000000">AI</text>
        </mask>
    </defs>
    <circle cx="12" cy="12" r="11" fill="currentColor" mask="url(#ai-cutout)" />
</svg>
`;
// END GENERATED ICON

export class KlikkikuriAiBadge extends createBadgeClass(svgMarkup, "AI content") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-ai-badge")) {
    window.customElements.define("klikkikuri-ai-badge", KlikkikuriAiBadge);
}
