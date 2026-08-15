"use strict";

import { createBadgeClass } from "./badge-base.js";

/**
 * Non-OSS variant of the AI badge using the Kagi-designed ai-stain icon.
 * Replaces the default EU AI circle badge in NON_OSS=1 builds.
 *
 * Dark/light adaptation: fill="currentColor" inherits :host color
 * (#000 light / #fff dark), matching the OSS badge behaviour.
 *
 * Icon design credit: Kagi (https://kagi.com)
 *
 * NOTE: Mirrors the structure of src/components/klikkikuri-ai-badge.js.
 * Keep in sync when the shared API or styles change.
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

:host {
    color: #000000;
}

@media (prefers-color-scheme: dark) {
    :host {
        color: #ffffff;
    }
}
</style>
<svg class="ai-icon" role="img" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <!-- Icon designed by Kagi (https://kagi.com) -->
    <path d="m11.12 9.15 1.07 3.01h-2.13zm4.17 6.13-3.06-8.15h-2.17l-3.06 8.15h1.96l.51-1.43h3.31l.51 1.43zm.88 0h1.83v-8.15h-1.83v8.15zm7.82-4.6c.08.48-.43.85-.9.9s-.94-.09-1.4.02-.92.6-.67 1.06.91.32 1.4.16 1.24-.04 1.22.49c-.01.31-.33.52-.63.55s-.6-.08-.89-.11c-1.41-.19-2.73 1.43-2.34 2.85.15.51.46.95.67 1.44s.37 1 .01 1.54-1.13.58-1.72.37-1.11-.61-1.71-.81-1.3-.23-1.68.46.13 1.52.53 2.19.52 1.8-.05 2.12-1.28-.26-1.45-.92.07-2.04.07-2.04-.03.52 0-.01-.52-.88-.95-.6-.61.49-1.32.15-1.17-1.06-1.67-1.69-1.06-1.25-1.97-1.16-1.5 1.05-1.91 1.9-1.26 1.88-1.84 1.99-1.2-.19-1.51-.72-.32-1.17.11-1.73 1.01-.6 1.69-1.21.83-1.82.44-2.56-1.15-1.16-1.88-1.52-1.5-.76-1.91-1.49-.32-1.84.56-2.12 1.85.74 2.68.32c.4-.21.59-.7.58-1.16s.2-.15-.43-1.29-1.82-2.32-2.57-2.85-1.62-.93-2.16-1.69-.64-1.97.22-2.49 1.92.33 2.36 1.26.6 2.04 1.29 2.79c1.08 1.15 3.18.76 3.96-.63.24-.43.37-.91.62-1.34s.53-.81 1.14-.79 1.02.64 1.38 1.15 1.01 1.01 1.51.79.62-.89.54-1.45-.34-.81-.18-1.66 1.18-1.38 1.94-1.03 1 1.6.64 2.2-1.12 1.09-1.08 1.73.77 1.01 1.39.92.83-.34 1.71-.74 2.32-.4 2.82-.28 1.04.31 1.17.92-.38 1.16-.87 1.51-1.04.5-1.2 1.32.62 1.53 1.39 1.76 2.09.46 2.33.6.48.34.52.63z"/>
</svg>
`;

export class KlikkikuriAiBadge extends createBadgeClass(templateHtml, "AI content") {}

if (typeof window !== "undefined" && window.customElements && !window.customElements.get("klikkikuri-ai-badge")) {
    window.customElements.define("klikkikuri-ai-badge", KlikkikuriAiBadge);
}
