"use strict";

import { createBadgeClass } from "./badge-base.js";
import { knockoutMask } from "./badge-style.js";

/**
 * Custom Web Component for converted headline badges.
 * Marks a headline whose text Paatti replaced with the dataset's aligned title.
 *
 * The artwork is a placeholder — two arrows knocked out of a rounded square — awaiting the real
 * icon. The body is painted with `currentColor` and the arrows are knocked out of it, so the badge
 * adapts to the page's own colours. See badge-style.js.
 */
const BODY = `<rect x="3" y="3" width="18" height="18" rx="4" />`;
const ARROWS = `<path d="M6 8h9V6l4 3-4 3v-2H6z" /><path d="M18 14H9v-2l-4 3 4 3v-2h9z" />`;

const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    ${knockoutMask("converted-cutout", BODY, ARROWS)}
    <g fill="currentColor" mask="url(#converted-cutout)">${BODY}</g>
</svg>
`;

export class KlikkikuriConvertedBadge extends createBadgeClass(svgMarkup, "Converted headline") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-converted-badge")) {
    window.customElements.define("klikkikuri-converted-badge", KlikkikuriConvertedBadge);
}
