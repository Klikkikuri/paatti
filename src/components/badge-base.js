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
 *  - `label` / `tooltip` / `action` attribute observation
 *  - SVG aria-label and <title> synchronisation
 *  - Forcing display:inline-flex via inline style so host-page stylesheets
 *    (which take precedence over shadow-internal :host rules) cannot hide the badge
 *
 * `action` names the control the badge becomes: giving it turns the badge from an image into a button,
 * with a tab stop, a role, that name, and Enter or Space. The badge does not know what the action is --
 * whoever set the attribute listens for the click. Badges run in the page's main world, where
 * `browser.i18n` does not exist, so the name arrives already translated, as `label` and `tooltip` do.
 *
 * Name it as a noun phrase, not as a command. A badge sits inside the headline's link, and a link takes
 * its own name from the text it contains -- so whatever this says is read twice: once as the button, and
 * again as the opening words of the link around it. "Converted headline feedback" survives that; "Report
 * this converted headline" turns every headline into an instruction.
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
            return ["label", "tooltip", "action"];
        }

        /**
         * Keyboard activation, routed through `click()` so the pointer and the keyboard arrive at the one
         * listener the badge's owner registered. A field, not a method, so add and remove see one function.
         */
        _onKeydown = (event) => {
            if (!this.hasAttribute("action") || (event.key !== "Enter" && event.key !== " ")) return;
            // Space scrolls the page and Enter submits a surrounding form, neither of which was asked for.
            event.preventDefault();
            this.click();
        };

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
            this.addEventListener("keydown", this._onKeydown);
            this._updateLabels();
        }

        disconnectedCallback() {
            this.removeEventListener("keydown", this._onKeydown);
        }

        attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue !== newValue) {
                this._updateLabels();
            }
        }

        /**
         * Sync the badge's labelling and its role from the component's attributes.
         */
        _updateLabels() {
            const svg = this.shadowRoot.querySelector("svg");
            if (!svg) return;

            const label = this.getAttribute("label") || this.getAttribute("tooltip") || defaultLabel;
            const tooltip = this.getAttribute("tooltip") || label;
            const action = this.getAttribute("action");

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

            // An action badge is a control rather than a picture, so it is announced and reached as one.
            // The icon is hidden from the accessibility tree while it is: the button carries the name, and
            // an image with a name of its own inside it would be read out a second time.
            if (action) {
                this.setAttribute("role", "button");
                this.setAttribute("tabindex", "0");
                this.setAttribute("aria-label", action);
                svg.setAttribute("aria-hidden", "true");
            } else {
                this.removeAttribute("role");
                this.removeAttribute("tabindex");
                this.removeAttribute("aria-label");
                svg.removeAttribute("aria-hidden");
            }
        }
    };
}
