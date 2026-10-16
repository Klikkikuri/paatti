import browser from '../../browser-api.js';
import { getConfig, onConfigValue } from '../../config.js';
import { originPatterns, canAddProviders, ARBITRARY_ORIGINS } from '../origins.js';
import { localizeDocument } from '../utils.js';
import {
    MAX_PROVIDERS, getProviders, addProvider, removeProvider, setProviderEnabled, getProviderData,
    refreshProviders
} from '../../providers.js';
import { inspect } from '../../provider.js';
import { adoptComponentStyleSheet, ComponentBase, defineComponent, emitSettingSaved } from './component-utils.js';
import './toggle-button.js';

/**
 * @file providers-setting.js
 * The "Providers" section: the list of third-party manifests the user added, and the two-gesture flow
 * that adds one.
 *
 * Firefox honours `permissions.request` only inside a user gesture and only before the first `await`,
 * so the flow is exactly the two clicks the design calls for and no more:
 *
 * - "Add" requests the manifest URL's own origin, synchronously, then calls `inspect()` and shows what
 *   it found -- every resource origin the manifest names, and the sites a same-origin document already
 *   reveals -- before anything else is requested or fetched.
 * - "Add provider", shown only once that disclosure is up, requests the resource origins it just
 *   listed, synchronously, then calls `refreshProviders()`, which resolves and persists it.
 *
 * A provider's own sites are not granted here: they arrive offered but off in the ordinary site list,
 * and turning one on requests its origin the same way any other site does.
 */

adoptComponentStyleSheet(new URL('./providers-setting.css', import.meta.url));

const template = document.createElement('template');
template.innerHTML = `
    <div class="providers-list"></div>
    <div class="provider-add">
        <div class="provider-add-form">
            <input type="url" id="providerUrlInput" name="providerUrl" class="provider-url-input" data-i18n-placeholder="providerUrlPlaceholder" placeholder="https://example.com/manifest.json">
            <button type="button" class="btn-secondary provider-add-btn" data-i18n="providerAddBtn">Add</button>
        </div>
        <p class="provider-add-error" hidden></p>
        <div class="provider-disclosure" hidden>
            <p class="provider-disclosure-origins-intro" data-i18n="providerDisclosureOriginsIntro">This provider will be fetched from:</p>
            <ul class="provider-disclosure-origins"></ul>
            <p class="provider-disclosure-sites-intro" hidden data-i18n="providerDisclosureSitesIntro">It already offers these sites:</p>
            <ul class="provider-disclosure-sites"></ul>
            <p class="provider-disclosure-ignored" hidden></p>
            <div class="provider-disclosure-actions">
                <button type="button" class="btn-secondary provider-cancel-btn" data-i18n="providerCancelBtn">Cancel</button>
                <button type="button" class="btn-primary provider-confirm-btn" data-i18n="providerConfirmBtn">Add provider</button>
            </div>
        </div>
    </div>
`;

const rowTemplate = document.createElement('template');
rowTemplate.innerHTML = `
    <div class="provider-info">
        <div class="provider-url"></div>
        <div class="provider-status"></div>
    </div>
    <toggle-button type="toggle"></toggle-button>
    <button type="button" class="btn-secondary provider-remove-btn" data-i18n="providerRemoveBtn">Remove</button>
`;

class ProvidersSetting extends ComponentBase {
    #list = null;
    #urlInput = null;
    #addButton = null;
    #addError = null;
    #disclosure = null;
    #cancelButton = null;
    #confirmButton = null;
    #pendingUrl = null;
    #pendingInspection = null;
    /** An in-flight render whose result would land after a newer one starts is dropped. */
    #renderGeneration = 0;

    onConnect() {
        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);

        this.#list = this.querySelector('.providers-list');
        this.#urlInput = this.querySelector('.provider-url-input');
        this.#addButton = this.querySelector('.provider-add-btn');
        this.#addError = this.querySelector('.provider-add-error');
        this.#disclosure = this.querySelector('.provider-disclosure');
        this.#cancelButton = this.querySelector('.provider-cancel-btn');
        this.#confirmButton = this.querySelector('.provider-confirm-btn');

        // A store build's manifest carries no wildcard optional host permission (storeManifest()
        // strips it), so permissions.request() throws for any origin this flow does not already
        // hold. Providers work on the GitHub build only; hide the way in on a build that cannot
        // grant it, rather than let every add attempt fail with an opaque error. The list of
        // providers already added (perhaps synced from a GitHub-build device) still shows; refreshOne() records why this
        // build does not use one that is not a default provider, and its status line shows that.
        const canAddProvider = canAddProviders(browser.runtime.getManifest());
        this.querySelector('.provider-add').hidden = !canAddProvider;
        if (canAddProvider) {
            this.#addButton.addEventListener('click', () => this.#onAddClick(), { signal: this.signal });
            this.#cancelButton.addEventListener('click', () => this.#resetAddFlow(), { signal: this.signal });
            this.#confirmButton.addEventListener('click', () => this.#onConfirmClick(), { signal: this.signal });
        }

        // Re-renders on a provider's own list changing (added, removed, enabled/disabled) and on its
        // resolved content changing (a refresh finding new sites, a fetch starting to fail). Both
        // land in storage.local under a provider: key, which config.js's siteConfigSource already
        // watches -- selecting it here keeps this in step with that, narrowly. This already fires
        // once with the current value, so nothing here calls #renderList() a second time for it.
        this.addTeardown(onConfigValue(
            (config) => [Object.keys(config.siteConfigSource || {}).sort(), Object.values(config.siteConfigSource || {})],
            () => this.#renderList(),
        ));
    }

    async #renderList() {
        const generation = ++this.#renderGeneration;
        const providers = await getProviders();
        if (!this.isConnected || generation !== this.#renderGeneration) return;

        this.#list.replaceChildren();
        if (providers.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'providers-empty';
            empty.textContent = browser.i18n.getMessage('providersEmpty') || 'No providers added yet.';
            this.#list.append(empty);
            return;
        }

        const config = await getConfig();
        for (const provider of providers) {
            const data = await getProviderData(provider.url);
            if (!this.isConnected || generation !== this.#renderGeneration) return;
            this.#list.append(this.#buildRow(provider, data, config));
        }
    }

    #buildRow(provider, data, config) {
        const row = document.createElement('div');
        row.className = 'provider-item';
        row.replaceChildren(rowTemplate.content.cloneNode(true));
        // The row is still detached: without this, `toggleBtn.checked` below lands on an un-upgraded element and shadows the setter.
        customElements.upgrade(row);
        localizeDocument(row);

        row.querySelector('.provider-url').textContent = provider.url;
        row.querySelector('.provider-status').textContent = this.#describeStatus(data, config);

        const toggleBtn = row.querySelector('toggle-button');
        toggleBtn.checked = provider.enabled;
        toggleBtn.addEventListener('toggle-change', async (event) => {
            const { checked } = event.detail;
            try {
                await setProviderEnabled(provider.url, checked);
                if (checked) await refreshProviders();
            } catch (err) {
                console.error(`Failed to ${checked ? 'enable' : 'disable'} provider ${provider.url}:`, err);
                toggleBtn.checked = !checked;
            }
        }, { signal: this.signal });

        const removeBtn = row.querySelector('.provider-remove-btn');
        // The active environment's default provider(s) cannot be deleted outright through this button --
        // only disabled via the toggle above. Read live off config.defaultProviders, not a stored marker,
        // so a URL that stops being default in a future version regains its Remove button on the very
        // next render with no migration needed.
        removeBtn.hidden = (config.defaultProviders || []).includes(provider.url);
        removeBtn.addEventListener('click', async () => {
            try {
                await removeProvider(provider.url);
                await this.#renderList();
                emitSettingSaved(this, {
                    key: 'providerRemoved', value: provider.url,
                    messageKey: 'providerRemoved', fallback: 'Provider removed',
                });
            } catch (err) {
                console.error(`Failed to remove provider ${provider.url}:`, err);
            }
        }, { signal: this.signal });

        return row;
    }

    /** A one-line summary: how many sites it offers, when it last resolved, and what went wrong if so. */
    #describeStatus(data, config) {
        const parts = [];
        const siteCount = Object.keys(data.siteConfigs || {}).length;
        parts.push(browser.i18n.getMessage('providerSiteCount', [String(siteCount)]) || `${siteCount} site(s)`);

        if (data.updated) {
            const when = new Date(data.updated).toLocaleString();
            parts.push(browser.i18n.getMessage('providerUpdatedAt', [when]) || `updated ${when}`);
        } else {
            parts.push(browser.i18n.getMessage('providerNeverResolved') || 'never resolved yet');
        }

        for (const rejection of data.rejected || []) {
            parts.push(this.#describeRejection(rejection, config.siteConfigSource || {}));
        }
        for (const error of data.errors || []) {
            parts.push(error.message || String(error));
        }

        return parts.join(' — ');
    }

    /** Names which source actually holds a rejected key, so an "already claimed" reason is not a dead end. */
    #describeRejection(rejection, siteConfigSource) {
        if (!rejection.key) return rejection.reason;
        if (/already claimed/.test(rejection.reason)) {
            const winner = siteConfigSource[rejection.key] || (browser.i18n.getMessage('providerBundledSet') || 'the bundled set');
            return browser.i18n.getMessage('providerClaimedBy', [rejection.key, winner]) || `${rejection.key}: claimed by ${winner}`;
        }
        return `${rejection.key}: ${rejection.reason}`;
    }

    async #onAddClick() {
        this.#addError.hidden = true;
        const raw = this.#urlInput.value.trim();
        if (!raw) return;

        const existing = await getProviders();
        if (existing.some((provider) => provider.url === raw)) {
            this.#showAddError(browser.i18n.getMessage('providerAlreadyAdded') || 'This provider is already added.');
            return;
        }
        if (existing.length >= MAX_PROVIDERS) {
            this.#showAddError(browser.i18n.getMessage('providerLimitReached') || `At most ${MAX_PROVIDERS} providers are allowed.`);
            return;
        }

        const manifestPattern = originPatterns([raw])[0];
        if (!manifestPattern) {
            this.#showAddError(browser.i18n.getMessage('providerInvalidUrl') || 'Enter a valid https:// URL.');
            return;
        }

        // Gesture one: requested synchronously, before any await below.
        this.#addButton.disabled = true;
        const granted = browser.permissions.request({ origins: [manifestPattern] });
        granted
            .then((ok) => this.#afterAddPermission(raw, ok))
            .catch((err) => {
                console.error('Failed to request the provider manifest permission:', err);
                this.#showAddError(browser.i18n.getMessage('permissionRequestError') || 'Error requesting permission');
            })
            .finally(() => { this.#addButton.disabled = false; });
    }

    async #afterAddPermission(url, granted) {
        if (!granted) {
            this.#showAddError(browser.i18n.getMessage('permissionNotGranted') || 'Permission was not granted');
            return;
        }

        const config = await getConfig();
        const result = await inspect(url, { loopbackProvidersEnabled: config.loopbackProvidersEnabled });
        if (!this.isConnected) return;
        if (result.error) {
            this.#showAddError(result.error);
            return;
        }

        this.#pendingUrl = url;
        this.#pendingInspection = result;
        this.#showDisclosure(result);
    }

    #showDisclosure(inspected) {
        this.querySelector('.provider-add-form').hidden = true;
        this.#disclosure.hidden = false;

        const origins = this.#disclosure.querySelector('.provider-disclosure-origins');
        origins.replaceChildren(...[...inspected.origins].map((origin) => {
            const li = document.createElement('li');
            li.textContent = origin;
            return li;
        }));

        const siteDomains = Object.keys(inspected.sites || {});
        const sitesIntro = this.#disclosure.querySelector('.provider-disclosure-sites-intro');
        const sites = this.#disclosure.querySelector('.provider-disclosure-sites');
        sitesIntro.hidden = siteDomains.length === 0;
        sites.replaceChildren(...siteDomains.map((domain) => {
            const li = document.createElement('li');
            li.textContent = `${inspected.sites[domain].name || domain} (${domain})`;
            return li;
        }));

        const ignored = this.#disclosure.querySelector('.provider-disclosure-ignored');
        ignored.hidden = !inspected.ignoredCount;
        if (inspected.ignoredCount) {
            ignored.textContent = browser.i18n.getMessage('providerIgnoredCount', [String(inspected.ignoredCount)])
                || `${inspected.ignoredCount} resource(s) ignored (unknown type)`;
        }
    }

    async #onConfirmClick() {
        const url = this.#pendingUrl;
        const inspected = this.#pendingInspection;
        if (!url || !inspected) return;

        const patterns = originPatterns([...inspected.origins]).filter((pattern) => pattern !== ARBITRARY_ORIGINS);

        // Gesture two: requested synchronously, before any await below. Nothing left to request for
        // an all-relative manifest, so this resolves at once and the click is pure confirmation.
        this.#confirmButton.disabled = true;
        const granted = patterns.length > 0
            ? browser.permissions.request({ origins: patterns })
            : Promise.resolve(true);

        granted
            .then((ok) => this.#afterConfirmPermission(url, ok))
            .catch((err) => {
                console.error('Failed to request the provider resource permissions:', err);
                this.#showAddError(browser.i18n.getMessage('permissionRequestError') || 'Error requesting permission');
            })
            .finally(() => { this.#confirmButton.disabled = false; });
    }

    async #afterConfirmPermission(url, granted) {
        if (!granted) {
            this.#showAddError(browser.i18n.getMessage('permissionNotGranted') || 'Permission was not granted');
            return;
        }

        try {
            await addProvider(url);
            await refreshProviders();
        } catch (err) {
            console.error(`Failed to add provider ${url}:`, err);
            this.#showAddError(err.message || String(err));
            return;
        }

        this.#resetAddFlow();
        await this.#renderList();
        emitSettingSaved(this, {
            key: 'providerAdded', value: url,
            messageKey: 'providerAdded', fallback: 'Provider added',
        });
    }

    #showAddError(message) {
        this.#addError.textContent = message;
        this.#addError.hidden = false;
    }

    #resetAddFlow() {
        this.#pendingUrl = null;
        this.#pendingInspection = null;
        this.#disclosure.hidden = true;
        this.querySelector('.provider-add-form').hidden = false;
        this.#urlInput.value = '';
        this.#addError.hidden = true;
    }
}

defineComponent('providers-setting', ProvidersSetting);
