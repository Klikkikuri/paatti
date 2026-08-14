"use strict";

/**
 * Custom Web Component for video content badges.
 * Displays a play-in-screen icon indicating the linked content is primarily video.
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

.video-icon {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    min-width: 16px;
    min-height: 16px;
    flex-shrink: 0;
}

.video-icon-bg {
    fill: currentColor;
}

.video-icon-symbol {
    fill: #ffffff;
}

:host {
    color: #000000;
}

@media (prefers-color-scheme: dark) {
    :host {
        color: #ffffff;
    }
    .video-icon-symbol {
        fill: #000000;
    }
}
</style>
<svg class="video-icon" role="img" viewBox="0 0 24 24" width="18" height="18">
    <rect class="video-icon-bg" x="4" y="2" width="16" height="20" rx="3.5" />
    <path class="video-icon-symbol" d="M10 8L16.5 12L10 16Z" />
</svg>
`;

export class KlikkikuriVideoBadge extends HTMLElement {
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

        const label = this.getAttribute("label") || this.getAttribute("tooltip") || "Video content";
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

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-video-badge")) {
    window.customElements.define("klikkikuri-video-badge", KlikkikuriVideoBadge);
}
