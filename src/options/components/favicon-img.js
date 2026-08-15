"use strict";

import { browser } from '../../utils.js';

/**
 * Custom element for rendering site favicons using Manifest V3 _favicon/ routing.
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
     * Ensures the internal <img> element exists and initializes event handlers.
     */
    render() {
        if (!this.img) {
            this.img = document.createElement('img');
            this.img.alt = '';
            this.img.className = 'site-favicon-inner';

            // Gracefully handle load failures (e.g. unsupported platform, missing icon, or offline)
            this.img.addEventListener('error', () => {
                this.img.style.visibility = 'hidden';
            });
            this.img.addEventListener('load', () => {
                this.img.style.visibility = 'visible';
            });

            this.replaceChildren(this.img);
        }
        this.updateSource();
    }

    /**
     * Updates the inner <img> element dimensions and constructs the _favicon/ URL.
     */
    updateSource() {
        if (!this.img) return;

        const domain = this.getAttribute('domain') || '';
        const size = this.getAttribute('size') || '24';
        const numSize = parseInt(size, 10) || 24;

        this.img.width = numSize;
        this.img.height = numSize;

        if (!domain) {
            this.img.removeAttribute('src');
            this.img.style.visibility = 'hidden';
            return;
        }

        const pageUrl = domain.startsWith('http') ? domain : `https://${domain}`;

        try {
            const b = browser();
            // Construct chrome-extension://<id>/_favicon/?pageUrl=<url>&size=<size>
            const url = new URL(b.runtime.getURL('/_favicon/'));
            url.searchParams.append('pageUrl', pageUrl);
            url.searchParams.append('size', size);
            this.img.src = url.href;
            this.img.style.visibility = 'visible';
        } catch (e) {
            // Fail safely if runtime.getURL is unavailable or errors
            this.img.style.visibility = 'hidden';
        }
    }
}

customElements.define('favicon-img', FaviconImg);
