import browser from '../../browser-api.js';
import { getConfig, onConfigValue, PROVIDER_KEY_PREFIX } from '../../config.js';
import { originPatterns, canAddProviders, ARBITRARY_ORIGINS } from '../origins.js';
import { providerStateTag, originsToGrant } from '../provider-state.js';
import { siteLinks } from '../site-links.js';
import { localizeDocument } from '../utils.js';
import {
    MAX_PROVIDERS, getProviders, addProvider, removeProvider, setProviderEnabled, getProviderData,
    refreshProviders
} from '../../providers.js';
import { inspect } from '../../provider.js';
import { adoptComponentStyleSheet, ComponentBase, defineComponent, emitSettingSaved, detailLinks } from './component-utils.js';
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
 *
 * A row whose last refresh stopped on origins this browser has not granted -- a provider synced from another
 * device, or a manifest that names a new host -- offers "Grant access", a one-click request under the same rule.
 */

adoptComponentStyleSheet(new URL('./providers-setting.css', import.meta.url));

const template = document.createElement('template');
template.innerHTML = `
    <div class="providers-panel raised">
        <div class="providers-list"></div>
        <div class="provider-add">
            <form class="provider-add-form input-group" novalidate>
                <input type="url" id="providerUrlInput" name="providerUrl" class="provider-url-input" data-i18n-placeholder="providerUrlPlaceholder" placeholder="https://example.com/manifest.json">
                <button type="submit" class="provider-add-btn" data-i18n="providerAddBtn">Add</button>
            </form>
            <p class="provider-add-error" hidden></p>
            <div class="provider-disclosure" hidden>
                <p class="provider-disclosure-name" hidden></p>
                <div class="provider-links provider-disclosure-links" hidden></div>
                <p class="provider-disclosure-origins-intro" data-i18n="providerDisclosureOriginsIntro">This provider will be fetched from:</p>
                <ul class="provider-disclosure-origins"></ul>
                <p class="provider-disclosure-sites-intro" hidden data-i18n="providerDisclosureSitesIntro">It already offers these sites:</p>
                <ul class="provider-disclosure-sites"></ul>
                <p class="provider-disclosure-ignored" hidden></p>
                <div class="provider-disclosure-actions">
                    <button type="button" class="push-button provider-cancel-btn" data-i18n="providerCancelBtn">Cancel</button>
                    <button type="button" class="push-button provider-confirm-btn" data-i18n="providerConfirmBtn">Add provider</button>
                </div>
            </div>
        </div>
    </div>
`;

const rowTemplate = document.createElement('template');
rowTemplate.innerHTML = `
    <div class="provider-info">
        <div class="provider-title">
            <span class="provider-name"></span>
            <span class="provider-tag provider-default-tag" hidden data-i18n="providerDefaultTag">Default</span>
            <span class="provider-tag provider-state-tag" data-tone="warning" hidden></span>
        </div>
        <div class="provider-url"></div>
        <div class="provider-status"></div>
        <div class="provider-problems" hidden></div>
        <div class="provider-links" hidden></div>
    </div>
    <button type="button" class="push-button provider-grant-btn" hidden data-i18n="providerGrantBtn">Grant access</button>
    <toggle-button></toggle-button>
    <button type="button" class="push-button provider-remove-btn" data-i18n="providerRemoveBtn">Remove</button>
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
    /** The list as last rendered, so "Add" can check it without an await before its permission request. */
    #providers = [];
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
            this.querySelector('.provider-add-form').addEventListener('submit', (event) => {
                event.preventDefault();
                this.#onAddClick();
            }, { signal: this.signal });
            this.#cancelButton.addEventListener('click', () => this.#resetAddFlow(), { signal: this.signal });
            this.#confirmButton.addEventListener('click', () => this.#onConfirmClick(), { signal: this.signal });
        }

        // Fires once with the current value, which is the first render, and again when the sites the providers
        // claim move -- an environment switch included, which changes the default providers.
        this.addTeardown(onConfigValue(
            (config) => [Object.keys(config.siteConfigSource || {}).sort(), Object.values(config.siteConfigSource || {})],
            () => this.#scheduleRender(),
        ));

        // The list itself (sync) and each provider's resolved content (local, one write per refresh). Neither is
        // part of the merged config: an error or a provider with no sites would otherwise never reach the screen.
        const onStorageChanged = (changes, areaName) => {
            const keys = Object.keys(changes);
            if ((areaName === 'sync' && keys.includes('providers'))
                || (areaName === 'local' && keys.some((key) => key.startsWith(PROVIDER_KEY_PREFIX)))) {
                this.#scheduleRender();
            }
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        this.addTeardown(() => browser.storage.onChanged.removeListener(onStorageChanged));
    }

    #scheduleRender() {
        this.#renderList().catch((err) => console.error('Failed to render the providers:', err));
    }

    async #renderList() {
        const generation = ++this.#renderGeneration;
        const providers = await getProviders();
        if (!this.isConnected || generation !== this.#renderGeneration) return;

        this.#providers = providers;
        if (providers.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'providers-empty';
            empty.textContent = browser.i18n.getMessage('providersEmpty') || 'No providers added yet.';
            this.#list.replaceChildren(empty);
            return;
        }

        // Swapped in at once after every read, so a refresh writing provider after provider never blanks the list.
        const config = await getConfig();
        const rows = [];
        for (const provider of providers) {
            const data = await getProviderData(provider.url);
            if (!this.isConnected || generation !== this.#renderGeneration) return;
            rows.push(this.#buildRow(provider, data, config));
        }
        this.#list.replaceChildren(...rows);
    }

    #buildRow(provider, data, config) {
        const row = document.createElement('div');
        row.className = 'provider-item';
        row.replaceChildren(rowTemplate.content.cloneNode(true));
        // The row is still detached: without this, `toggleBtn.checked` below lands on an un-upgraded element and shadows the setter.
        customElements.upgrade(row);
        localizeDocument(row);

        // The name is the provider's own claim, so the URL it was added by stays in view beside it.
        row.querySelector('.provider-name').textContent = data.name || provider.url;
        const urlLine = row.querySelector('.provider-url');
        urlLine.textContent = provider.url;
        urlLine.hidden = !data.name;
        row.querySelector('.provider-status').textContent = this.#describeStatus(data);
        const problems = this.#describeProblems(data, config);
        const problemsLine = row.querySelector('.provider-problems');
        problemsLine.textContent = problems.join(' — ');
        problemsLine.hidden = problems.length === 0;
        const isDefault = (config.defaultProviders || []).includes(provider.url);
        row.querySelector('.provider-default-tag').hidden = !isDefault;

        const tag = providerStateTag(data);
        const stateTag = row.querySelector('.provider-state-tag');
        stateTag.hidden = !tag;
        if (tag) stateTag.textContent = browser.i18n.getMessage(tag.key) || tag.fallback;

        this.#fillLinks(row.querySelector('.provider-links'), data.links);

        const grantOrigins = originsToGrant(provider, data, browser.runtime.getManifest());
        const grantBtn = row.querySelector('.provider-grant-btn');
        grantBtn.hidden = !grantOrigins;
        grantBtn.addEventListener('click', () => {
            // Requested synchronously, inside the input handler. A refusal changes nothing: the row still says why.
            grantBtn.disabled = true;
            browser.permissions.request({ origins: grantOrigins })
                .then(async (granted) => {
                    if (!granted) return;
                    await refreshProviders();
                    await this.#renderList();
                })
                .catch((err) => console.error(`Failed to grant access for provider ${provider.url}:`, err))
                .finally(() => { grantBtn.disabled = false; });
        }, { signal: this.signal });

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
        removeBtn.hidden = isDefault;
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

    #fillLinks(container, links) {
        const entries = siteLinks(links, browser.i18n.getUILanguage(), (key) => browser.i18n.getMessage(key));
        container.replaceChildren(...detailLinks(entries));
        container.hidden = entries.length === 0;
    }

    /** A one-line summary: how many sites it offers and when it last resolved. */
    #describeStatus(data) {
        const parts = [];
        const siteCount = Object.keys(data.siteConfigs || {}).length;
        parts.push(browser.i18n.getMessage('providerSiteCount', [String(siteCount)]) || `${siteCount} site(s)`);

        if (data.updated) {
            const when = new Date(data.updated).toLocaleString();
            parts.push(browser.i18n.getMessage('providerUpdatedAt', [when]) || `updated ${when}`);
        } else {
            parts.push(browser.i18n.getMessage('providerNeverResolved') || 'never resolved yet');
        }
        return parts.join(' — ');
    }

    /** What went wrong on the last resolve: rejected sites and fetch errors. */
    #describeProblems(data, config) {
        const parts = [];
        for (const rejection of data.rejected || []) {
            parts.push(this.#describeRejection(rejection, config.siteConfigSource || {}));
        }
        for (const error of data.errors || []) {
            parts.push(error.message || String(error));
        }
        return parts;
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

    /** Nothing here may await before `permissions.request`. A stale list is safe: addProvider() decides again. */
    #onAddClick() {
        this.#addError.hidden = true;
        const raw = this.#urlInput.value.trim();
        if (!raw) return;

        const existing = this.#providers;
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

        // Gesture one: requested synchronously, inside the input handler.
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

        const name = this.#disclosure.querySelector('.provider-disclosure-name');
        name.textContent = inspected.manifest.name || '';
        name.hidden = !inspected.manifest.name;
        this.#fillLinks(this.#disclosure.querySelector('.provider-disclosure-links'), inspected.manifest.links);

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

    #onConfirmClick() {
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
