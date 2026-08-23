"use strict";

import { createBadgeClass } from "./badge-base.js";
import { knockoutMask } from "./badge-style.js";

/**
 * Custom Web Component for video content badges.
 * Displays a play-in-screen icon indicating the linked content is primarily video.
 *
 * The screen is painted with `currentColor` and the play triangle is knocked out
 * of it, so the badge adapts to the page's own colours. See badge-style.js.
 */
const SCREEN = `<rect x="4" y="2" width="16" height="20" rx="3.5" />`;
const PLAY = `<path d="M10 8L16.5 12L10 16Z" />`;

const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    ${knockoutMask("video-cutout", SCREEN, PLAY)}
    <g fill="currentColor" mask="url(#video-cutout)">${SCREEN}</g>
</svg>
`;

export class KlikkikuriVideoBadge extends createBadgeClass(svgMarkup, "Video content") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-video-badge")) {
    window.customElements.define("klikkikuri-video-badge", KlikkikuriVideoBadge);
}
