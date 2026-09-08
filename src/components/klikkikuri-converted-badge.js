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

<svg width="18" height="18" viewBox="0 0 4.4332918 3.9918399" id="svg1" sodipodi:docname="converted-badge.svg" inkscape:version="1.4.4 (dcaf3e7d9e, 2026-05-05)" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img"><path
     style="fill:none;stroke:currentColor;stroke-width:0.3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:fill markers stroke"
     d="M 0.15490775,3.5445739 C 0.56622885,3.0595688 0.76775515,2.5743658 0.82633015,2.0863614 0.83969015,2.0498864 1.6371874,1.945656 1.6371874,1.945656 L 0.81394805,1.3419646 C 0.75858535,0.94840736 0.63328925,0.55220836 0.47237515,0.15203106 1.2549853,0.30251616 3.5584829,1.0933387 4.2882077,3.494775 c 0,0 -0.3211332,0.3356243 -0.5726861,0.3485915 -0.2515529,0.012967 -0.7594317,-0.3610412 -0.7594317,-0.3610412 0,0 -0.4925559,0.3656358 -0.7718814,0.3610412 C 1.904883,3.8387765 1.4496764,3.4698756 1.4496764,3.4698756 c 0,0 -0.45403325,0.3700669 -0.69718315,0.3734909 -0.2431499,0.00342 -0.5975855,-0.2987926 -0.5975855,-0.2987926 z"
     id="path1"
     sodipodi:nodetypes="ccccccscccsc" /></svg>
`;
// END GENERATED ICON

export class KlikkikuriConvertedBadge extends createBadgeClass(svgMarkup, "Converted headline") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-converted-badge")) {
    window.customElements.define("klikkikuri-converted-badge", KlikkikuriConvertedBadge);
}
