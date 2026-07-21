import { browser, getCurrentTabHostname } from '../../utils.js';
import { controller } from '../../controller.js';
import { model } from '../../model.js';
import { getConfig } from '../../config.js';
import { isSiteEnabled } from '../utils.js';
import { handleSiteToggleHelper } from './site-toggle.js';

/**
 * Custom element representing the circular power button in the popup.
 * Manages its own state, permissions, and settings toggle logic.
 */
export class PowerButton extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
        this.domain = null;
        this.origins = [];
        this.isSiteSupported = false;
        this.hasPermission = false;
    }

    /**
     * Lifecycle callback when element is added to DOM.
     */
    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        this.style.display = 'inline-block';
        this.style.width = '50px';
        this.style.height = '50px';

        this.render();
        this.loadState();

        // Auto-sync status when settings are changed elsewhere
        this.storageListener = () => this.sync();
        browser().storage.onChanged.addListener(this.storageListener);
    }

    /**
     * Lifecycle callback when element is removed from DOM.
     */
    disconnectedCallback() {
        if (this.storageListener) {
            browser().storage.onChanged.removeListener(this.storageListener);
        }
    }

    /**
     * Render the initial HTML structure.
     */
    render() {
        this.innerHTML = `
            <input class="conversion-switch hidden" id="site-enabled" type="checkbox">
            <label class="push-button" for="site-enabled">&#x23FB;</label>
        `;
    }

    /**
     * Fetch the active tab's hostname and resolve config-based permissions.
     */
    async loadState() {
        try {
            const pageHostname = await getCurrentTabHostname();
            const matchingDomain = await model.read.getMatchingSiteDomain(pageHostname);
            
            this.domain = matchingDomain || pageHostname;
            this.isSiteSupported = matchingDomain !== null;

            const config = await getConfig();
            this.origins = matchingDomain ? (config.siteConfigs[matchingDomain]?.origins || []) : [];
            if (this.origins.length === 0) {
                this.origins = [`https://${pageHostname}/*`];
            }

            await this.sync();
            this.setupListeners();
        } catch (err) {
            console.error('Failed to load power button state:', err);
        }
    }

    /**
     * Synchronize element UI state with actual settings and permissions.
     */
    async sync() {
        if (!this.domain) return;

        const isEnabled = this.isSiteSupported ? await isSiteEnabled(this.domain) : false;
        
        // Query permissions
        const hasPermission = this.origins.length > 0 
            ? await browser().permissions.contains({ origins: this.origins }) 
            : false;
        
        this.hasPermission = hasPermission;

        const checkbox = this.querySelector('input');
        const label = this.querySelector('label');

        if (checkbox) {
            checkbox.checked = isEnabled;
            checkbox.disabled = !this.isSiteSupported;
            checkbox.dataset.hostname = this.domain;
            checkbox.dataset.origins = JSON.stringify(this.origins);
            checkbox.dataset.hasPermission = String(hasPermission);
        }

        if (label) {
            if (!this.isSiteSupported) {
                label.style.opacity = '0.5';
                label.style.cursor = 'not-allowed';
            } else {
                label.style.opacity = '1.0';
                label.style.cursor = 'pointer';
            }
        }
    }

    /**
     * Add change event listener to the checkbox.
     */
    setupListeners() {
        const checkbox = this.querySelector('input');
        if (!checkbox) return;

        checkbox.addEventListener('change', async () => {
            const checked = checkbox.checked;
            
            await handleSiteToggleHelper(
                checked,
                this.domain,
                this.origins,
                this.hasPermission,
                true, // Close popup immediately on permission prompt
                {
                    onSuccess: (enabled, message) => {
                        this.dispatchEvent(new CustomEvent('power-toggled', {
                            bubbles: true,
                            detail: { domain: this.domain, enabled, success: true, message }
                        }));
                    },
                    onFailure: (revertState, message) => {
                        checkbox.checked = revertState;
                        this.dispatchEvent(new CustomEvent('power-toggled', {
                            bubbles: true,
                            detail: { domain: this.domain, enabled: revertState, success: false, message }
                        }));
                    },
                    onPermissionGranted: () => {
                        this.hasPermission = true;
                        checkbox.dataset.hasPermission = 'true';
                    }
                }
            );
        });
    }
}

customElements.define('power-button', PowerButton);
