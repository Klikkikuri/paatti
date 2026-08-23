"use strict";

import { badgeStyleSheet } from "./badge-style.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Parse a badge's SVG markup into a detached element owned by this document.
 *
 * The markup is an in-repo constant, but it reaches this module as a parameter, so assigning it to
 * `innerHTML` reads as a dynamic assignment and add-on review rejects it. DOMParser reads the markup
 * as XML, which never runs script.
 *
 * XML has no implicit namespace, so the markup must carry `xmlns` on its root — unlike the HTML
 * parser, which puts an `<svg>` tag in the SVG namespace by itself. Markup that omits it still parses
 * cleanly into elements merely *named* "svg", which the shared stylesheet sizes into a convincing
 * blank box, so the namespace is checked here rather than left to show up as a badge that never draws.
 *
 * @param {string} markup - Well-formed standalone `<svg>` markup, with `xmlns` on the root.
 * @returns {SVGElement} The parsed `<svg>` root.
 */
function parseBadgeSvg(markup) {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");

    // Both faults below are mistakes in a source constant, so fail loudly instead of shipping a blank badge.
    const parseError = parsed.querySelector("parsererror");
    if (parseError) {
        throw new Error(`Badge SVG markup is not well-formed: ${parseError.textContent.trim()}`);
    }

    const root = parsed.documentElement;
    if (root.namespaceURI !== SVG_NS) {
        throw new Error(`Badge SVG markup must declare xmlns="${SVG_NS}" on its root element.`);
    }

    return document.importNode(root, true);
}

/**
 * Factory that creates a badge Web Component class sharing common badge behaviour.
 * Each badge only needs to supply its own SVG markup and a fallback label string;
 * the styling comes from the shared stylesheet in badge-style.js.
 *
 * The returned class handles:
 *  - Shadow root attachment, stylesheet adoption and icon cloning
 *  - `label` / `tooltip` attribute observation
 *  - SVG aria-label and <title> synchronisation
 *  - Forcing display:inline-flex via inline style so host-page stylesheets
 *    (which take precedence over shadow-internal :host rules) cannot hide the badge
 *
 * @param {string} svgMarkup - The badge's `<svg>` markup.
 * @param {string} defaultLabel - Fallback aria-label when no attribute is set.
 * @returns {typeof HTMLElement} A custom element class ready for registration.
 */
export function createBadgeClass(svgMarkup, defaultLabel) {
    // Parsed once per badge class; every instance gets a clone of this one node.
    const badgeSvg = parseBadgeSvg(svgMarkup);

    return class extends HTMLElement {
        static get observedAttributes() {
            return ["label", "tooltip"];
        }

        constructor() {
            super();
            if (!this.shadowRoot) {
                this.attachShadow({ mode: "open" });
                // One parsed stylesheet shared by every badge, rather than a
                // <style> element cloned into each instance.
                this.shadowRoot.adoptedStyleSheets = [badgeStyleSheet];
                this.shadowRoot.appendChild(badgeSvg.cloneNode(true));
            }
        }

        connectedCallback() {
            // Inline !important wins over any host-page stylesheet rules targeting the element.
            this.style.setProperty("display", "inline-flex", "important");
            this._updateLabels();
        }

        attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue !== newValue) {
                this._updateLabels();
            }
        }

        /**
         * Sync the SVG's aria-label and <title> element from the component's attributes.
         */
        _updateLabels() {
            const svg = this.shadowRoot.querySelector("svg");
            if (!svg) return;

            const label = this.getAttribute("label") || this.getAttribute("tooltip") || defaultLabel;
            const tooltip = this.getAttribute("tooltip") || label;

            svg.setAttribute("aria-label", label);

            let titleElement = svg.querySelector("title");
            if (tooltip) {
                if (!titleElement) {
                    titleElement = document.createElementNS(SVG_NS, "title");
                    svg.prepend(titleElement);
                }
                titleElement.textContent = tooltip;
            } else if (titleElement) {
                titleElement.remove();
            }
        }
    };
}
