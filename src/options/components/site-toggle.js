import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { isSiteEnabled } from '../utils.js';
import { siteLinks } from '../site-links.js';
import { getConfig } from '../../config.js';
import './toggle-button.js';
import './favicon-img.js';
import { adoptComponentStyleSheet, defineComponent, detailLinks } from './component-utils.js';

// This element's CSS travels with it: a page gets the styling by importing the module.
adoptComponentStyleSheet(new URL('./site-toggle.css', import.meta.url));
const compactTemplate = document.createElement('template');
compactTemplate.innerHTML = `
    <div class="compact-site-info">
        <favicon-img class="site-favicon" size="18"></favicon-img>
        <label class="site-label"></label>
    </div>
    <toggle-button type="toggle"></toggle-button>
`;

const detailedTemplate = document.createElement('template');
detailedTemplate.innerHTML = `
    <div class="site-main-section">
        <div class="site-info">
            <favicon-img class="site-favicon" size="24"></favicon-img>
            <div class="site-details">
                <div class="site-name"></div>
                <div class="site-domain"></div>
                <div class="site-status" role="status"></div>
                <div class="site-details-container"></div>
            </div>
        </div>
    </div>
    <toggle-button></toggle-button>
`;

/**
 * The message key and English text for the state of a site, in words, so that the toggle is not the only signal.
 *
 * @param {boolean} enabled - Whether the user has the site on.
 * @param {boolean} hasPermission - Whether the browser has granted the site's origins.
 * @returns {{key: string, fallback: string}}
 */
export function siteStatusOf(enabled, hasPermission) {
    if (enabled) return { key: 'siteStatusOn', fallback: 'On' };
    if (!hasPermission) return { key: 'siteStatusNeedsPermission', fallback: 'Needs permission' };
    return { key: 'siteStatusOff', fallback: 'Off' };
}

/**
 * Custom element representing a site-specific toggle setting.
 * Supports "detailed" (with icons and domains) and "compact" layouts.
 * Composes the generic <toggle-button> custom element.
 */
class SiteToggleSetting extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.state = { enabled: false, hasPermission: false };
    }

    /** Write the state of the site as text, in the detailed layout. The compact layout has no room for it. */
    renderStatus(state) {
        this.state = { ...this.state, ...state };
        const statusEl = this.querySelector('.site-status');
        if (!statusEl) return;

        const { key, fallback } = siteStatusOf(this.state.enabled, this.state.hasPermission);
        statusEl.textContent = browser.i18n.getMessage(key) || fallback;
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
            this.replaceChildren(compactTemplate.content.cloneNode(true));

            const faviconEl = this.querySelector('favicon-img');
            if (faviconEl) faviconEl.setAttribute('domain', domain);

            const labelEl = this.querySelector('.site-label');
            if (labelEl) {
                labelEl.setAttribute('for', `toggle-${domain}`);
                labelEl.textContent = name;
            }
        } else {
            // Detailed layout for the options page
            this.classList.add('site-item');
            this.replaceChildren(detailedTemplate.content.cloneNode(true));

            const faviconEl = this.querySelector('favicon-img');
            if (faviconEl) faviconEl.setAttribute('domain', domain);

            const nameEl = this.querySelector('.site-name');
            if (nameEl) nameEl.textContent = name;

            const domainEl = this.querySelector('.site-domain');
            if (domainEl) domainEl.textContent = domain;
        }

        const toggleBtn = this.querySelector('toggle-button');
        if (toggleBtn) {
            toggleBtn.setAttribute('id', `toggle-${domain}`);
        }

        // Allow clicking anywhere on the row to toggle (excluding detail buttons or switch itself)
        this.addEventListener('click', (e) => {
            if (e.target.closest('toggle-button') || e.target.closest('.detail-button')) return;
            toggleBtn.checked = !toggleBtn.checked;
            toggleBtn.dispatchEvent(new CustomEvent('toggle-change', {
                bubbles: true,
                detail: { checked: toggleBtn.checked }
            }));
        });

        // Fetch state asynchronously
        this.loadState(toggleBtn, domain, origins, layout);
    }

    /**
     * Asynchronously loads status and registers change listeners.
     */
    async loadState(toggleBtn, domain, origins, layout) {
        const isEnabled = await isSiteEnabled(domain);
        const hasPermission = origins.length > 0 ? await browser.permissions.contains({ origins }) : false;

        toggleBtn.checked = isEnabled;
        toggleBtn.dataset.hasPermission = String(hasPermission);
        this.renderStatus({ enabled: isEnabled, hasPermission });

        // Populate dataset on the inner checkbox for backward compatibility (e.g. read-only class selection)
        const innerCheckbox = toggleBtn.querySelector('input');
        if (innerCheckbox) {
            innerCheckbox.dataset.site = domain;
            innerCheckbox.dataset.origins = JSON.stringify(origins);
            innerCheckbox.dataset.hasPermission = String(hasPermission);
        }

        // Fetch site-specific metadata for the site's links
        try {
            const config = await getConfig();
            const siteConfig = config.siteConfigs ? config.siteConfigs[domain] || {} : {};
            const links = siteLinks(siteConfig.links, browser.i18n.getUILanguage(), (key) => browser.i18n.getMessage(key));

            const detailsContainer = this.querySelector('.site-details-container');
            if (detailsContainer && layout !== 'compact' && links.length > 0) {
                detailsContainer.replaceChildren(...detailLinks(links));
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
                        this.renderStatus({ enabled });
                        this.dispatchEvent(new CustomEvent('site-toggled', {
                            bubbles: true,
                            detail: { domain, enabled, success: true, message }
                        }));
                    },
                    onFailure: (revertState, message) => {
                        toggleBtn.checked = revertState;
                        this.renderStatus({ enabled: revertState });
                        this.dispatchEvent(new CustomEvent('site-toggled', {
                            bubbles: true,
                            detail: { domain, enabled: revertState, success: false, message }
                        }));
                    },
                    onPermissionGranted: () => {
                        this.renderStatus({ hasPermission: true });
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
    const successMsg = browser.i18n.getMessage('siteSettingSaved', [domain]) || `Setting for ${domain} saved!`;
    const errorMsg = browser.i18n.getMessage('siteSettingSaveError') || 'Error saving site setting';
    const noPermMsg = browser.i18n.getMessage('permissionNotGranted') || 'Permission was not granted';
    const reqPermErrorMsg = browser.i18n.getMessage('permissionRequestError') || 'Error requesting permission';

    if (checked) {
        if (currentHasPermission) {
            try {
                await controller.setSiteEnabled(true, domain);
                callbacks.onSuccess(true, successMsg);
            } catch (error) {
                callbacks.onFailure(false, errorMsg);
            }
        } else {
            if (closeOnPermissionRequest) {
                try {
                    browser.permissions.request({ origins });
                    window.close();
                } catch (error) {
                    callbacks.onFailure(false, reqPermErrorMsg);
                }
            } else {
                try {
                    const granted = await browser.permissions.request({ origins });
                    if (granted) {
                        await controller.setSiteEnabled(true, domain);
                        callbacks.onPermissionGranted();
                        callbacks.onSuccess(true, successMsg);
                    } else {
                        callbacks.onFailure(false, noPermMsg);
                    }
                } catch (error) {
                    callbacks.onFailure(false, reqPermErrorMsg);
                }
            }
        }
    } else {
        try {
            await controller.setSiteEnabled(false, domain);
            callbacks.onSuccess(false, successMsg);
        } catch (error) {
            callbacks.onFailure(true, errorMsg);
        }
    }
}

defineComponent('site-toggle-setting', SiteToggleSetting);
