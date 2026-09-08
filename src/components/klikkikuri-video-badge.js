"use strict";

import { createBadgeClass } from "./badge-base.js";

/**
 * Custom Web Component for video content badges.
 * Displays a play-in-screen icon indicating the linked content is primarily video.
 *
 * The screen is painted with `currentColor` and the play triangle is knocked out
 * of it, so the badge adapts to the page's own colours. See badge-style.js.
 */

// @icon-source assets/icons/video-badge.svg
// BEGIN GENERATED ICON -- edit the .svg, then run `make icons`
const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    <!-- A screen in the headline's colour with the play triangle knocked out of it, so the page's
         own background shows through. White paints the mask, black cuts it. -->
    <defs>
        <mask id="video-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect x="4" y="2" width="16" height="20" rx="3.5" fill="#ffffff" />
            <path d="M10 8L16.5 12L10 16Z" fill="#000000" />
        </mask>
    </defs>
    <rect x="4" y="2" width="16" height="20" rx="3.5" fill="currentColor" mask="url(#video-cutout)" />
</svg>
`;
// END GENERATED ICON

export class KlikkikuriVideoBadge extends createBadgeClass(svgMarkup, "Video content") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-video-badge")) {
    window.customElements.define("klikkikuri-video-badge", KlikkikuriVideoBadge);
}
