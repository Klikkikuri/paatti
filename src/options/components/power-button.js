import browser from '../../browser-api.js';
import { getCurrentTabHostname } from '../../utils.js';
import { model } from '../../model.js';
import { getConfig, onConfigValue } from '../../config.js';
import { isSiteEnabled } from '../utils.js';
import { handleSiteToggleHelper } from './site-toggle.js';
import { ComponentBase, defineComponent } from './component-utils.js';

const template = document.createElement('template');
template.innerHTML = `
    <input class="conversion-switch visually-hidden" id="site-enabled" type="checkbox" aria-label="Toggle extension for current site">
    <label class="push-button" for="site-enabled">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 60%; height: 60%;">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
            <line x1="12" y1="2" x2="12" y2="12"></line>
        </svg>
    </label>
`;

/**
 * Custom element representing the circular power button in the popup.
 * Manages its own state, permissions, and settings toggle logic.
 */
export class PowerButton extends ComponentBase {
    domain = null;
    origins = [];
    isSiteSupported = false;
    hasPermission = false;

    onConnect() {
        this.style.display = 'inline-block';

        this.render();
        this.loadState();

        // The selector reads this.domain, which loadState() fills in asynchronously. Until
        // it does, sync() returns early and the shape stays provisional; the first real
        // change corrects it. loadState()'s own sync() is what paints the initial state.
        this.addTeardown(onConfigValue(
            (config) => [config.enabled, this.domain ? config.siteConfigs[this.domain]?.enabled : null],
            () => this.sync()
        ));
    }

    /**
     * Render the initial HTML structure.
     */
    render() {
        this.replaceChildren(template.content.cloneNode(true));
        
        const localizedLabel = browser.i18n.getMessage("powerButtonAriaLabel") || "Toggle extension for current site";
        
        const checkbox = this.querySelector('input');
        if (checkbox) {
            checkbox.setAttribute('aria-label', localizedLabel);
        }
        
        const label = this.querySelector('label');
        if (label) {
            label.setAttribute('title', localizedLabel);
        }
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
            ? await browser.permissions.contains({ origins: this.origins }) 
            : false;
        
        this.hasPermission = hasPermission;
        if (!this.isConnected) return;

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
        }, { signal: this.signal });
    }
}

defineComponent('power-button', PowerButton);
