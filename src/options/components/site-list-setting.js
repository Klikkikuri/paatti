import { getConfig, onConfigValue } from '../../config.js';
import './site-toggle.js';
import { adoptComponentStyleSheet, ComponentBase, defineComponent } from './component-utils.js';

adoptComponentStyleSheet(new URL('./site-list-setting.css', import.meta.url));

/**
 * Custom element managing the list of site-specific toggle settings in the options page.
 * Dynamically queries configurations and appends site-toggle-setting elements.
 */
class SiteListSetting extends ComponentBase {
    /** An in-flight render whose result would land after a newer one starts is dropped. */
    #renderGeneration = 0;

    onConnect() {
        // The set of configured sites is no longer fixed: a provider can add or drop one at
        // runtime. Selecting just the sorted domain list, not the whole siteConfigs object, keeps
        // this from re-rendering (and losing each site-toggle-setting's own in-flight state) on an
        // unrelated field changing, such as a site being turned on -- that owns itself already.
        this.addTeardown(onConfigValue(
            (config) => Object.keys(config.siteConfigs || {}).sort(),
            () => this.render(),
        ));
    }

    async render() {
        // Two onConfigValue firings in quick succession start two overlapping renders; without this,
        // whichever's getConfig() happens to resolve last wins, even if it started first and is now
        // the stale one.
        const generation = ++this.#renderGeneration;
        try {
            const config = await getConfig();
            if (generation !== this.#renderGeneration) return;
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
