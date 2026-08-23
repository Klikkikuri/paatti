import { getConfig } from '../../config.js';
import './site-toggle.js';
import { adoptComponentStyleSheet, defineComponent } from './component-utils.js';

adoptComponentStyleSheet(new URL('./site-list-setting.css', import.meta.url));

/**
 * Custom element managing the list of site-specific toggle settings in the options page.
 * Dynamically queries configurations and appends site-toggle-setting elements.
 */
class SiteListSetting extends HTMLElement {
    connectedCallback() {

        // No subscription: the list is the set of configured sites, which does not change
        // at runtime, and each site-toggle-setting owns its own enabled state. render()
        // replaces its children, so a re-attach redraws rather than duplicating.
        this.render();
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

defineComponent('site-list-setting', SiteListSetting);
