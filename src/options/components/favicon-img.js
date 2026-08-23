"use strict";

import browser from '../../browser-api.js';
import { getFaviconKey, isFaviconExpired } from '../../faviconCache.js';

/**
 * Curated accessible palette for deterministic domain letter badges.
 */
const BADGE_PALETTE = [
    '#667eea', '#764ba2', '#3182ce', '#319795',
    '#38a169', '#d69e2e', '#dd6b20', '#e53e3e',
    '#805ad5', '#d53f8c'
];

/**
 * Cached promise determining whether the runtime supports the MV3 favicon API permission.
 * @type {Promise<boolean>|null}
 */
let faviconApiSupportedPromise = null;

/**
 * Checks whether the browser runtime grants and supports the 'favicon' permission.
 * Chromium returns true when 'favicon' is in manifest permissions.
 * Firefox does not support this permission and returns false or rejects.
 *
 * @returns {Promise<boolean>} True if the favicon API is supported and granted.
 */
async function supportsFaviconApi() {
    if (faviconApiSupportedPromise !== null) {
        return faviconApiSupportedPromise;
    }
    faviconApiSupportedPromise = (async () => {
        try {
            if (browser?.permissions?.contains) {
                return await browser.permissions.contains({ permissions: ['favicon'] });
            }
        } catch (_err) {
            // Non-supporting browsers (e.g. Firefox) reject unknown permission names
        }
        return false;
    })();
    return faviconApiSupportedPromise;
}

/**
 * Custom element for rendering site favicons with a tiered fallback pipeline.
 * Tier 1: MV3 _favicon/ internal routing (Chromium)
 * Tier 2: Base64 data-URI cached by background script in browser.storage.local
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
                // Prevent infinite loop if Tier 2 (data URI) fails to load
                if (this.img.src.startsWith('data:')) {
                    this.showFallback();
                } else {
                    this.resolveFallbackTier();
                }
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
     * Resolves through the tiered fallback chain.
     * Tier 2: Base64 data-URI from browser.storage.local (privacy-first, all browsers).
     * Tier 3: Deterministic initial-letter placeholder badge (terminal fallback).
     *
     * @returns {Promise<void>}
     */
    async resolveFallbackTier() {
        const domain = this.getAttribute('domain') || '';

        if (domain) {
            try {
                const key = getFaviconKey(domain);
                let stored = await browser.storage.local.get(key);
                let entry = stored?.[key];

                // If not found or expired, try fallback with or without www. prefix
                if (!entry || isFaviconExpired(entry)) {
                    const altDomain = domain.startsWith('www.')
                        ? domain.slice(4)
                        : `www.${domain}`;
                    const altKey = getFaviconKey(altDomain);
                    const altStored = await browser.storage.local.get(altKey);
                    if (altStored?.[altKey] && !isFaviconExpired(altStored[altKey])) {
                        entry = altStored[altKey];
                    }
                }

                if (entry && !isFaviconExpired(entry) && entry.data !== null) {
                    // Valid, non-expired cached favicon — show it
                    if (this.img) {
                        this.img.src = entry.data;
                        if (this.img.complete && this.img.naturalWidth > 0) {
                            this.img.style.display = 'block';
                            if (this.fallbackBadge) {
                                this.fallbackBadge.style.display = 'none';
                            }
                        }
                    }
                    return;
                }
            } catch (_err) {
                // Storage unavailable — fall through to Tier 3
            }
        }

        // Tier 3: Terminal fallback
        this.showFallback();
    }

    /**
     * Executes the tiered resolution pipeline.
     *
     * @returns {Promise<void>}
     */
    async updateSource() {
        const domain = this.getAttribute('domain') || '';
        const size = this.getAttribute('size') || '24';
        const numSize = parseInt(size, 10) || 24;

        if (!domain) {
            await this.resolveFallbackTier();
            return;
        }

        if (this.img) {
            this.img.width = numSize;
            this.img.height = numSize;
        }

        // --- Tier 1: MV3 _favicon/ Routing ---
        const hasFaviconApi = await supportsFaviconApi();
        if (!hasFaviconApi) {
            // Browser does not support the MV3 favicon permission/API
            await this.resolveFallbackTier();
            return;
        }

        try {
            const pageUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            const url = new URL(browser.runtime.getURL('/_favicon/'));
            url.searchParams.append('pageUrl', pageUrl);
            url.searchParams.append('size', size);

            this.img.src = url.href;
        } catch (e) {
            await this.resolveFallbackTier();
        }
    }
}

customElements.define('favicon-img', FaviconImg);
