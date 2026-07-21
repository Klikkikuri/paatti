import { browser } from '../../utils.js';
import { controller } from '../../controller.js';
import { isSiteEnabled } from '../utils.js';
import { getConfig } from '../../config.js';
import './toggle-button.js';

/**
 * Custom element representing a site-specific toggle setting.
 * Supports "detailed" (with icons and domains) and "compact" layouts.
 * Composes the generic <toggle-button> custom element.
 */
class SiteToggleSetting extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
    }

    /**
     * Lifecycle callback when element is added to DOM.
     */
    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        const domain = this.getAttribute('domain');
        const name = this.getAttribute('name') || domain;
        const layout = this.getAttribute('layout') || 'detailed';
        let origins = [];
        try {
            origins = JSON.parse(this.getAttribute('origins') || '[]');
        } catch (e) {
            origins = [`https://${domain}/*`];
        }
        if (origins.length === 0) {
            origins = [`https://${domain}/*`];
        }

        if (layout === 'compact') {
            // Compact layout for the popup settings view
            this.classList.add('compact-setting-row');

            this.innerHTML = `
                <label for="toggle-${domain}">${name}</label>
                <toggle-button type="toggle" id="toggle-${domain}"></toggle-button>
            `;
        } else {
            // Detailed layout for the options page
            this.classList.add('site-item');
            
            const faviconUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
            this.innerHTML = `
                <div class="site-main-section" style="display: flex; flex-direction: column; flex: 1; margin-right: 20px; align-items: flex-start;">
                    <div class="site-info" style="display: flex; align-items: center; gap: 12px; width: 100%;">
                        <img src="${faviconUrl}" alt="" width="24" height="24" class="site-favicon">
                        <div>
                            <div class="site-name" style="font-weight: bold; color: #333;">${name}</div>
                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; line-height: 1.2;">
                                <span class="site-domain text-muted-small" style="line-height: 1.2;">${domain}</span>
                                <span class="site-details-container" style="display: inline-flex; align-items: center; line-height: 1.2;"></span>
                            </div>
                        </div>
                    </div>
                </div>
                <toggle-button id="toggle-${domain}"></toggle-button>
            `;
        }

        const toggleBtn = this.querySelector('toggle-button');

        // Allow clicking anywhere on the row to toggle (excluding detail buttons or switch itself)
        if (layout !== 'compact') {
            this.addEventListener('click', (e) => {
                if (e.target.closest('toggle-button') || e.target.closest('.detail-button')) return;
                toggleBtn.checked = !toggleBtn.checked;
                toggleBtn.dispatchEvent(new CustomEvent('toggle-change', {
                    bubbles: true,
                    detail: { checked: toggleBtn.checked }
                }));
            });
        }

        // Fetch state asynchronously
        this.loadState(toggleBtn, domain, origins, layout);
    }

    /**
     * Asynchronously loads status and registers change listeners.
     */
    async loadState(toggleBtn, domain, origins, layout) {
        const isEnabled = await isSiteEnabled(domain);
        const hasPermission = origins.length > 0 ? await browser().permissions.contains({ origins }) : false;

        toggleBtn.checked = isEnabled;
        toggleBtn.dataset.hasPermission = String(hasPermission);

        // Populate dataset on the inner checkbox for backward compatibility (e.g. read-only class selection)
        const innerCheckbox = toggleBtn.querySelector('input');
        if (innerCheckbox) {
            innerCheckbox.dataset.site = domain;
            innerCheckbox.dataset.origins = JSON.stringify(origins);
            innerCheckbox.dataset.hasPermission = String(hasPermission);
        }

        // Fetch site-specific metadata for policy URL
        try {
            const config = await getConfig();
            const siteConfig = config.siteConfigs ? config.siteConfigs[domain] || {} : {};
            const policyUrl = siteConfig.policyUrl;

            const detailsContainer = this.querySelector('.site-details-container');
            if (detailsContainer && layout !== 'compact' && policyUrl) {
                const linkText = browser().i18n.getMessage('sitePolicyLinkText') || 'Julkaisijan periaatteet';
                detailsContainer.innerHTML = `<a href="${policyUrl}" target="_blank" class="detail-button">${linkText} ↗</a>`;
            }
        } catch (err) {
            console.error('Failed to load site toggle metadata:', err);
        }

        toggleBtn.addEventListener('toggle-change', async (e) => {
            const checked = e.detail.checked;
            const currentHasPermission = toggleBtn.dataset.hasPermission === 'true';

            await handleSiteToggleHelper(
                checked,
                domain,
                origins,
                currentHasPermission,
                layout === 'compact',
                {
                    onSuccess: (enabled, message) => {
                        this.dispatchEvent(new CustomEvent('site-toggled', {
                            bubbles: true,
                            detail: { domain, enabled, success: true, message }
                        }));
                    },
                    onFailure: (revertState, message) => {
                        toggleBtn.checked = revertState;
                        this.dispatchEvent(new CustomEvent('site-toggled', {
                            bubbles: true,
                            detail: { domain, enabled: revertState, success: false, message }
                        }));
                    },
                    onPermissionGranted: () => {
                        toggleBtn.dataset.hasPermission = 'true';
                        if (innerCheckbox) innerCheckbox.dataset.hasPermission = 'true';
                    }
                }
            );
        });
    }
}

/**
 * Shared helper to handle toggling site enabled state and permissions request.
 * @param {boolean} checked - The target toggle state.
 * @param {string} domain - The site domain.
 * @param {string[]} origins - Optional permission origins.
 * @param {boolean} currentHasPermission - Whether permission is currently granted.
 * @param {boolean} closeOnPermissionRequest - Whether to immediately close the window on permission request.
 * @param {object} callbacks - Callback actions for success, failure, and permission grants.
 * @param {function} callbacks.onSuccess - Callback on successful toggle.
 * @param {function} callbacks.onFailure - Callback on failed toggle.
 * @param {function} callbacks.onPermissionGranted - Callback when permission is granted.
 */
export async function handleSiteToggleHelper(checked, domain, origins, currentHasPermission, closeOnPermissionRequest, callbacks) {
    if (checked) {
        if (currentHasPermission) {
            try {
                await controller.setSiteEnabled(true, domain);
                callbacks.onSuccess(true, `Sivuston ${domain} asetus tallennettu!`);
            } catch (error) {
                callbacks.onFailure(false, 'Virhe tallennettaessa sivuston asetusta');
            }
        } else {
            if (closeOnPermissionRequest) {
                try {
                    browser().permissions.request({ origins });
                    window.close();
                } catch (error) {
                    callbacks.onFailure(false, 'Virhe pyydettäessä lupaa');
                }
            } else {
                try {
                    const granted = await browser().permissions.request({ origins });
                    if (granted) {
                        await controller.setSiteEnabled(true, domain);
                        callbacks.onPermissionGranted();
                        callbacks.onSuccess(true, `Sivuston ${domain} asetus tallennettu!`);
                    } else {
                        callbacks.onFailure(false, 'Lupaa ei myönnetty');
                    }
                } catch (error) {
                    callbacks.onFailure(false, 'Virhe pyydettäessä lupaa');
                }
            }
        }
    } else {
        try {
            await controller.setSiteEnabled(false, domain);
            callbacks.onSuccess(false, `Sivuston ${domain} asetus tallennettu!`);
        } catch (error) {
            callbacks.onFailure(true, 'Virhe tallennettaessa sivuston asetusta');
        }
    }
}

customElements.define('site-toggle-setting', SiteToggleSetting);
