"use strict";

import { createBadgeClass } from "./badge-base.js";
import { knockoutMask } from "./badge-style.js";

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
const CIRCLE = `<circle cx="12" cy="12" r="11" />`;
const LETTERS = `<text class="badge-glyph-font" x="12" y="15.5" text-anchor="middle">AI</text>`;

const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    ${knockoutMask("ai-cutout", CIRCLE, LETTERS)}
    <g fill="currentColor" mask="url(#ai-cutout)">${CIRCLE}</g>
</svg>
`;

export class KlikkikuriAiBadge extends createBadgeClass(svgMarkup, "AI content") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-ai-badge")) {
    window.customElements.define("klikkikuri-ai-badge", KlikkikuriAiBadge);
}
