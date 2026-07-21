import { browser } from '../../utils.js';
import { getConfig } from '../../config.js';
import './site-toggle.js';

/**
 * Custom element managing the list of site-specific toggle settings in the options page.
 * Dynamically queries configurations and appends site-toggle-setting elements.
 */
class SiteListSetting extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
    }

    connectedCallback() {
        this.style.display = 'block';
        if (this.initialized) return;
        this.initialized = true;

        this.render();

        // Listen for configuration updates to redraw list toggles if modified elsewhere
        this.storageListener = (changes) => {
            if (changes.config) {
                this.render();
            }
        };
        browser().storage.onChanged.addListener(this.storageListener);
    }

    disconnectedCallback() {
        if (this.storageListener) {
            browser().storage.onChanged.removeListener(this.storageListener);
        }
    }

    async render() {
        try {
            const config = await getConfig();
            const siteConfigs = config.siteConfigs || {};

            const listContainer = document.createElement('div');
            listContainer.className = 'site-list';
            this.replaceChildren(listContainer);
            if (!listContainer) return;

            for (const [domain, siteConfig] of Object.entries(siteConfigs)) {
                const siteToggle = document.createElement('site-toggle-setting');
                siteToggle.setAttribute('domain', domain);
                siteToggle.setAttribute('name', siteConfig.name || domain);
                siteToggle.setAttribute('origins', JSON.stringify(siteConfig.origins || [`https://${domain}/*`]));
                
                listContainer.appendChild(siteToggle);
            }
        } catch (err) {
            console.error('Error rendering site-list-setting:', err);
        }
    }
}

customElements.define('site-list-setting', SiteListSetting);
