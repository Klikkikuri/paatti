"use strict";

/**
 * Custom Web Component for EU-styled AI content badges.
 * Displays the official EU AI circle badge icon (solid circle with bold 'AI' cutout/fill).
 */
const template = document.createElement("template");
template.innerHTML = `
<style>
:host {
    display: inline-flex !important;
    align-items: center;
    vertical-align: middle;
    margin-right: 0.35em;
    font-size: 0.85em;
    line-height: 1;
    user-select: none;
}

.ai-icon {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    min-width: 16px;
    min-height: 16px;
    flex-shrink: 0;
}

.ai-icon-bg {
    fill: currentColor;
}

.ai-icon-text {
    fill: #ffffff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-weight: 800;
    font-size: 11px;
}

:host {
    color: #000000;
}

@media (prefers-color-scheme: dark) {
    :host {
        color: #ffffff;
    }
    .ai-icon-text {
        fill: #000000;
    }
}
</style>
<svg class="ai-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    <circle class="ai-icon-bg" cx="12" cy="12" r="11" />
    <text class="ai-icon-text" x="12" y="15.5" text-anchor="middle">AI</text>
</svg>
`;

export class KlikkikuriAiBadge extends HTMLElement {
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
        this.style.setProperty("display", "inline-flex", "important");
        this._updateLabels();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this._updateLabels();
        }
    }

    _updateLabels() {
        const svg = this.shadowRoot.querySelector("svg");
        if (!svg) return;

        const label = this.getAttribute("label") || this.getAttribute("tooltip") || "AI content";
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
}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-ai-badge")) {
    window.customElements.define("klikkikuri-ai-badge", KlikkikuriAiBadge);
}
