"use strict";

import { createBadgeClass } from "./badge-base.js";

/**
 * Custom Web Component for converted headline badges.
 * Marks a headline whose text Paatti replaced with the dataset's aligned title.
 *
 * The icon is Paatti's own mark -- a dorsal fin cutting two lines of water -- so the badge names
 * who changed the headline rather than describing the link. It is a silhouette in `currentColor`,
 * like the Kagi AI badge, so it inherits the headline's colour and needs no knockout: the waves
 * are strokes, which a knockout body would close up at badge size. See badge-style.js for why no
 * explicit light/dark colours are declared here.
 */

// @icon-source assets/icons/converted-badge.svg
// BEGIN GENERATED ICON -- edit the .svg, then run `make icons`
const svgMarkup = `
<!-- Created with Inkscape (http://www.inkscape.org/) -->

<svg width="18" height="18" viewBox="0 0 4.4332918 3.9918399" id="svg1" xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img"><defs
     id="defs1" /><path
     style="fill:none;stroke:currentColor;stroke-width:0.29104167;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:fill markers stroke"
     d="M 0.54321642,3.2583697 C 0.87405619,2.8682634 1.0361508,2.4779978 1.0832646,2.085479 1.0940106,2.0561409 1.7354652,1.9723048 1.7354652,1.9723048 L 1.0733053,1.486735 C 1.0287752,1.1701833 0.92799519,0.85150675 0.79856642,0.52963032 1.4280468,0.65067069 3.2808295,1.2867566 3.8677724,3.2183148 c 0,0 -0.2582985,0.2699542 -0.4606312,0.2803841 C 3.2048085,3.5091289 2.796304,3.208301 2.796304,3.208301 c 0,0 -0.3961797,0.2940935 -0.6208509,0.2903979 C 1.950782,3.4950089 1.5846436,3.1982873 1.5846436,3.1982873 c 0,0 -0.3651947,0.2976576 -0.5607685,0.3004116 C 0.82830122,3.5014489 0.54321642,3.2583697 0.54321642,3.2583697 Z"
     id="path1"
     /></svg>
`;
// END GENERATED ICON

export class KlikkikuriConvertedBadge extends createBadgeClass(svgMarkup, "Converted headline") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-converted-badge")) {
    window.customElements.define("klikkikuri-converted-badge", KlikkikuriConvertedBadge);
}
