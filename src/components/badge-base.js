"use strict";

/**
 * Factory that creates a badge Web Component class sharing common badge behaviour.
 * Each badge only needs to supply its own shadow DOM template (style + SVG markup)
 * and a fallback label string.
 *
 * The returned class handles:
 *  - Shadow root attachment and template cloning
 *  - `label` / `tooltip` attribute observation
 *  - SVG aria-label and <title> synchronisation
 *  - Forcing display:inline-flex via inline style so host-page stylesheets
 *    (which take precedence over shadow-internal :host rules) cannot hide the badge
 *
 * @param {string} templateHtml - Full shadow DOM template HTML (style + SVG).
 * @param {string} defaultLabel - Fallback aria-label when no attribute is set.
 * @returns {typeof HTMLElement} A custom element class ready for registration.
 */
export function createBadgeClass(templateHtml, defaultLabel) {
    const template = document.createElement("template");
    const doc = new DOMParser().parseFromString(templateHtml, "text/html");
    while (doc.head.firstChild) {
        template.content.appendChild(doc.head.firstChild);
    }
    while (doc.body.firstChild) {
        template.content.appendChild(doc.body.firstChild);
    }

    return class extends HTMLElement {
        static get observedAttributes() {
            return ["label", "tooltip"];
        }

        constructor() {
            super();
            if (!this.shadowRoot) {
                this.attachShadow({ mode: "open" });
                this.shadowRoot.appendChild(template.content.cloneNode(true));
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
                    titleElement = document.createElementNS("http://www.w3.org/2000/svg", "title");
                    svg.prepend(titleElement);
                }
                titleElement.textContent = tooltip;
            } else if (titleElement) {
                titleElement.remove();
            }
        }
    };
}
