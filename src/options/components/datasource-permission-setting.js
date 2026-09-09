import browser from '../../browser-api.js';
import { onConfigValue } from '../../config.js';
import { localizeDocument } from '../utils.js';
import { ARBITRARY_ORIGINS, originPatterns, missingOrigins } from '../origins.js';
import { adoptComponentStyleSheet, ComponentBase, defineComponent, emitSettingSaved } from './component-utils.js';

adoptComponentStyleSheet(new URL('./datasource-permission-setting.css', import.meta.url));

const template = document.createElement('template');
template.innerHTML = `
    <p class="datasource-permission-warning" hidden></p>
    <button type="button" class="btn-secondary" disabled data-i18n="requestDatasourcePermissionBtn">🔓 Request access permission</button>
`;

/**
 * Shows which development database URLs the browser has not granted, and requests them.
 *
 * The button is hidden on a build whose manifest lacks the wildcard optional host permission (the store
 * build): a request for an undeclared origin throws there. The warning shows on every build.
 */
class DatasourcePermissionSetting extends ComponentBase {
    #urls = [];
    #generation = 0;
    #canRequest = false;
    #pending = false;
    #button = null;
    #warning = null;

    onConnect() {
        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);
        this.#button = this.querySelector('button');
        this.#warning = this.querySelector('.datasource-permission-warning');
        this.#canRequest = Boolean(browser.runtime.getManifest().optional_host_permissions?.includes(ARBITRARY_ORIGINS));
        this.#button.hidden = !this.#canRequest;

        this.addTeardown(onConfigValue(
            (config) => config.environmentConfigs.development.titleDataUrls,
            (urls) => {
                this.#urls = urls || [];
                this.#refresh();
            },
        ));

        this.#button.addEventListener('click', () => {
            this.request(this.#urls)
                .then((granted) => emitSettingSaved(this, {
                    key: 'datasourcePermission',
                    value: this.#urls,
                    success: granted,
                    messageKey: granted ? 'datasourcePermissionGranted' : 'permissionNotGranted',
                    fallback: granted ? 'Access granted for the database URLs' : 'Permission was not granted',
                }))
                .catch(() => emitSettingSaved(this, {
                    key: 'datasourcePermission',
                    value: this.#urls,
                    success: false,
                    messageKey: 'permissionRequestError',
                    fallback: 'Error requesting permission',
                }));
        }, { signal: this.signal });
    }

    /**
     * Ask the browser for the origins of `urls`. Call it inside a user gesture, before any await: Firefox
     * honours a permission request only then. An origin already granted does not prompt.
     *
     * @param {string[]} urls
     * @returns {Promise<boolean>|null} Whether every origin is granted; null on a build that cannot request.
     */
    request(urls) {
        if (!this.#canRequest) return null;

        // Disabled while pending: a second request before the prompt is answered throws.
        this.#pending = true;
        this.#button.disabled = true;
        const result = browser.permissions.request({ origins: originPatterns(urls) });
        result.catch(() => false).then(() => {
            this.#pending = false;
            this.#refresh();
        });

        return result;
    }

    /** Recompute what is missing: the warning lists it, and the button is enabled only while there is some. */
    async #refresh() {
        this.#button.disabled = true;
        const generation = ++this.#generation;
        try {
            const missing = await missingOrigins(this.#urls, (origin) => browser.permissions.contains({ origins: [origin] }));
            if (!this.isConnected || generation !== this.#generation) return;

            this.#button.disabled = missing.length === 0 || this.#pending;
            this.#warning.hidden = missing.length === 0;
            const list = missing.join(', ');
            this.#warning.textContent = browser.i18n.getMessage('datasourcePermissionMissing', [list]) || `⚠️ No permission to fetch: ${list}`;
        } catch (error) {
            console.error('Failed to check the database URL permissions:', error);
        }
    }
}

defineComponent('datasource-permission-setting', DatasourcePermissionSetting);
