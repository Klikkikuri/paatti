"use strict";

import { adoptBadgeStyles } from "./badge-style.js";

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

/** Parsed once per markup string: a page can carry dozens of badges, all cloning the same icon. */
const parsedIcons = new Map();

function iconFor(svgMarkup) {
    let icon = parsedIcons.get(svgMarkup);
    if (!icon) {
        icon = parseBadgeSvg(svgMarkup);
        parsedIcons.set(svgMarkup, icon);
    }
    return icon;
}

/** Give `element` its shadow root: the shared styles and a clone of the icon. Idempotent. */
function dressBadge(element, svgMarkup) {
    if (element.shadowRoot) return;

    const shadow = element.attachShadow({ mode: "open" });
    adoptBadgeStyles(shadow);
    shadow.appendChild(iconFor(svgMarkup).cloneNode(true));
}

/**
 * Sync a badge's labelling and its role from its attributes.
 *
 * @param {Element} element
 * @param {string} defaultLabel - Fallback aria-label when no attribute is set.
 */
function updateBadgeLabels(element, defaultLabel) {
    const svg = element.shadowRoot?.querySelector("svg");
    if (!svg) return;

    const label = element.getAttribute("label") || element.getAttribute("tooltip") || defaultLabel;
    const tooltip = element.getAttribute("tooltip") || label;
    const action = element.getAttribute("action");

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
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", action);
        svg.setAttribute("aria-hidden", "true");
    } else {
        element.removeAttribute("role");
        element.removeAttribute("tabindex");
        element.removeAttribute("aria-label");
        svg.removeAttribute("aria-hidden");
    }
}

/**
 * Keyboard activation, routed through `click()` so the pointer and the keyboard arrive at the one
 * listener the badge's owner registered.
 *
 * A button's two keys do not behave alike, and these follow the native contract: Enter acts on the
 * way down, Space on the way up. Acting on every Space keydown would activate once per repeat while
 * the key is held. The keydown is still swallowed on those repeats, or the page scrolls under a held
 * key -- and Enter's default is swallowed too, or it submits a form the badge happens to sit in.
 *
 * @param {Element} element
 * @returns {{onKeydown: (event: KeyboardEvent) => void, onKeyup: (event: KeyboardEvent) => void}}
 */
function badgeKeyHandlers(element) {
    return {
        onKeydown: (event) => {
            if (!element.hasAttribute("action")) return;
            if (event.key === " ") {
                event.preventDefault();
            } else if (event.key === "Enter" && !event.repeat) {
                event.preventDefault();
                element.click();
            }
        },
        onKeyup: (event) => {
            if (!element.hasAttribute("action") || event.key !== " ") return;
            event.preventDefault();
            element.click();
        }
    };
}

/**
 * A badge built for a page the extension does not own, without the page's custom element registry.
 *
 * The registry is not available to reach for. Chromium gives a content script no `customElements` at
 * all, and registering one from the page's own world means putting the extension's URL in the page's
 * DOM -- which in Firefox is a per-install identifier any page could then read. So the content script
 * builds the element itself, exactly as highlight-overlay.js does, and the tag name stays unregistered.
 *
 * The element is built complete and is not updated afterwards: a conversion pass replaces every badge
 * on the page rather than editing the ones already there.
 *
 * @param {object} badge
 * @param {string} badge.tagName - The unregistered tag to carry the badge; also what a click delegate matches.
 * @param {string} badge.svgMarkup
 * @param {string} badge.defaultLabel
 * @param {string} [badge.label]
 * @param {string} [badge.tooltip]
 * @param {string} [badge.action] - Naming an action turns the badge from an image into a button.
 * @returns {HTMLElement}
 */
export function buildBadge({ tagName, svgMarkup, defaultLabel, label, tooltip, action }) {
    const element = document.createElement(tagName);
    dressBadge(element, svgMarkup);

    if (label) element.setAttribute("label", label);
    if (tooltip) {
        element.setAttribute("tooltip", tooltip);
        element.setAttribute("title", tooltip);
    }
    if (action) element.setAttribute("action", action);

    // Inline !important wins over any host-page stylesheet rules targeting the element.
    element.style.setProperty("display", "inline-flex", "important");

    const { onKeydown, onKeyup } = badgeKeyHandlers(element);
    element.addEventListener("keydown", onKeydown);
    element.addEventListener("keyup", onKeyup);

    updateBadgeLabels(element, defaultLabel);
    return element;
}

/**
 * The badge as a custom element, for the extension's own pages, where the registry is ours to use.
 * A page the extension does not own gets `buildBadge` instead, and both share the behaviour above.
 *
 * The class adds what only a registered element can have: attribute observation, so a badge already
 * on screen re-labels itself when an attribute changes, and connect/disconnect for its listeners.
 *
 * `action` names the control the badge becomes: giving it turns the badge from an image into a button,
 * with a tab stop, a role, that name, and Enter or Space. The badge does not know what the action is --
 * whoever set the attribute listens for the click. The name arrives already translated, as `label` and
 * `tooltip` do: a badge never reads `browser.i18n` itself.
 *
 * Name it as a noun phrase, not as a command. A badge sits inside the headline's link, and a link takes
 * its own name from the text it contains -- so whatever this says is read twice: once as the button, and
 * again as the opening words of the link around it. "Converted headline feedback" survives that; "Report
 * this converted headline" turns every headline into an instruction.
 *
 * @param {string} svgMarkup - The badge's `<svg>` markup.
 * @param {string} defaultLabel - Fallback aria-label when no attribute is set.
 * @returns {typeof HTMLElement} A custom element class, for a caller to register.
 */
export function createBadgeClass(svgMarkup, defaultLabel) {
    return class extends HTMLElement {
        static get observedAttributes() {
            return ["label", "tooltip", "action"];
        }

        /** Fields, not methods, so add and remove see one function. */
        _keys = badgeKeyHandlers(this);

        constructor() {
            super();
            dressBadge(this, svgMarkup);
        }

        connectedCallback() {
            // Inline !important wins over any host-page stylesheet rules targeting the element.
            this.style.setProperty("display", "inline-flex", "important");
            this.addEventListener("keydown", this._keys.onKeydown);
            this.addEventListener("keyup", this._keys.onKeyup);
            this._updateLabels();
        }

        disconnectedCallback() {
            this.removeEventListener("keydown", this._keys.onKeydown);
            this.removeEventListener("keyup", this._keys.onKeyup);
        }

        attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue !== newValue) {
                this._updateLabels();
            }
        }

        _updateLabels() {
            updateBadgeLabels(this, defaultLabel);
        }
    };
}
