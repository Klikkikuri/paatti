"use strict";

import { createBadgeClass } from "./badge-base.js";

/**
 * Custom Web Component for EU-styled AI content badges.
 * Displays the official EU AI circle badge icon (solid circle with bold 'AI' cutout/fill).
 *
 * NOTE: A non-OSS variant of this file exists at
 * assets/non-oss/by-kagi/src/components/klikkikuri-ai-badge.js
 * which overrides this file in NON_OSS=1 builds. When modifying this file
 * (e.g. shared styles, component API, or custom element registration),
 * apply the same structural changes there as well.
 */
const templateHtml = `
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

export class KlikkikuriAiBadge extends createBadgeClass(templateHtml, "AI content") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-ai-badge")) {
    window.customElements.define("klikkikuri-ai-badge", KlikkikuriAiBadge);
}
