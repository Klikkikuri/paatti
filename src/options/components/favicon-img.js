"use strict";

import { browser } from '../../utils.js';

/**
 * Curated accessible palette for deterministic domain letter badges.
 */
const BADGE_PALETTE = [
    '#667eea', '#764ba2', '#3182ce', '#319795',
    '#38a169', '#d69e2e', '#dd6b20', '#e53e3e',
    '#805ad5', '#d53f8c'
];

/**
 * Custom element for rendering site favicons with a tiered fallback pipeline.
 * Tier 1: MV3 _favicon/ internal routing (Chromium)
 * Tier 2: [Reserved: Custom storage cache]
 * Tier 3: Deterministic initial-letter placeholder badge
 *
 * Operates directly in Light DOM to ensure external styles (e.g. border-radius, flex layout)
 * cascade naturally without needing Shadow DOM piercing.
 */
export class FaviconImg extends HTMLElement {
    /**
     * Attributes observed for reactive updates.
     * @returns {string[]} List of attribute names.
     */
    static get observedAttributes() {
        return ['domain', 'size'];
    }

    constructor() {
        super();
        this.img = null;
        this.fallbackBadge = null;
    }

    /**
     * Lifecycle callback invoked when the element is connected to the DOM.
     */
    connectedCallback() {
        this.render();
    }

    /**
     * Lifecycle callback invoked when observed attributes change.
     *
     * @param {string} name - Attribute name.
     * @param {string|null} oldValue - Previous attribute value.
     * @param {string|null} newValue - New attribute value.
     */
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && this.isConnected) {
            this.updateSource();
        }
    }

    /**
     * Extracts initial letter from domain (stripping www., m., http/https protocols).
     *
     * @param {string} domain - Domain string.
     * @returns {string} Uppercase initial character.
     */
    static getDomainInitial(domain) {
        if (!domain) return '?';
        const clean = domain.replace(/^(https?:\/\/)?(www\.|m\.)?/i, '');
        return (clean.charAt(0) || '?').toUpperCase();
    }

    /**
     * Computes a deterministic background color from the domain string.
     *
     * @param {string} domain - Domain string.
     * @returns {string} Hex color from curated palette.
     */
    static getBadgeColor(domain) {
        if (!domain) return BADGE_PALETTE[0];
        let hash = 0;
        for (let i = 0; i < domain.length; i++) {
            hash = (hash << 5) - hash + domain.charCodeAt(i);
            hash |= 0;
        }
        const index = Math.abs(hash) % BADGE_PALETTE.length;
        return BADGE_PALETTE[index];
    }

    /**
     * Ensures internal DOM elements exist and sets up event listeners.
     */
    render() {
        if (!this.img) {
            this.img = document.createElement('img');
            this.img.alt = '';
            this.img.className = 'site-favicon-inner';
            this.img.style.display = 'none';

            this.img.addEventListener('load', () => {
                this.img.style.display = 'block';
                if (this.fallbackBadge) {
                    this.fallbackBadge.style.display = 'none';
                }
            });

            this.img.addEventListener('error', () => {
                this.resolveFallbackTier();
            });

            this.fallbackBadge = document.createElement('span');
            this.fallbackBadge.className = 'site-favicon-fallback';
            this.fallbackBadge.setAttribute('aria-hidden', 'true');
            this.fallbackBadge.style.display = 'none';

            this.replaceChildren(this.fallbackBadge, this.img);
        }
        this.updateSource();
    }

    /**
     * Displays the Tier 3 letter fallback badge with deterministic color styling.
     */
    showFallback() {
        if (this.img) {
            this.img.style.display = 'none';
        }
        if (this.fallbackBadge) {
            const domain = this.getAttribute('domain') || '';
            const size = parseInt(this.getAttribute('size'), 10) || 24;

            this.fallbackBadge.textContent = FaviconImg.getDomainInitial(domain);
            this.fallbackBadge.style.backgroundColor = FaviconImg.getBadgeColor(domain);
            this.fallbackBadge.style.width = `${size}px`;
            this.fallbackBadge.style.height = `${size}px`;
            this.fallbackBadge.style.fontSize = `${Math.round(size * 0.55)}px`;
            this.fallbackBadge.style.lineHeight = `${size}px`;
            this.fallbackBadge.style.display = 'inline-flex';
            this.fallbackBadge.style.alignItems = 'center';
            this.fallbackBadge.style.justifyContent = 'center';
            this.fallbackBadge.style.color = '#ffffff';
            this.fallbackBadge.style.fontWeight = 'bold';
            this.fallbackBadge.style.borderRadius = '4px';
            this.fallbackBadge.style.userSelect = 'none';
        }
    }

    /**
     * Resolves through the tiered fallback chain:
     * Tier 2 (Future Storage) -> Tier 3 (Terminal Letter Badge).
     */
    resolveFallbackTier() {
        // [TIER 2 HOOK: Future custom storage lookup will be inserted here]

        // Tier 3: Terminal fallback
        this.showFallback();
    }

    /**
     * Executes the tiered resolution pipeline.
     */
    updateSource() {
        const domain = this.getAttribute('domain') || '';
        const size = this.getAttribute('size') || '24';
        const numSize = parseInt(size, 10) || 24;

        if (!domain) {
            this.resolveFallbackTier();
            return;
        }

        if (this.img) {
            this.img.width = numSize;
            this.img.height = numSize;
        }

        // --- Tier 1: MV3 _favicon/ Routing ---
        const isFirefox = typeof browser().runtime.getBrowserInfo === 'function';
        if (isFirefox) {
            // Firefox does not support MV3 _favicon/ internal routing
            this.resolveFallbackTier();
            return;
        }

        try {
            const b = browser();
            const pageUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            const url = new URL(b.runtime.getURL('/_favicon/'));
            url.searchParams.append('pageUrl', pageUrl);
            url.searchParams.append('size', size);

            this.img.src = url.href;
        } catch (e) {
            this.resolveFallbackTier();
        }
    }
}

customElements.define('favicon-img', FaviconImg);
