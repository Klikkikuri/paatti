import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const WILDCARD_MANIFEST = { optional_host_permissions: ['https://www.ampparit.com/*', '*://*/*'] };
const ARBITRARY_ORIGINS = '*://*/*';

const dom = installDom();
const fake = createFakeBrowser({
    messages: {
        providersEmpty: 'No providers added yet.',
        providerAddBtn: 'Add',
        providerCancelBtn: 'Cancel',
        providerConfirmBtn: 'Add provider',
        providerRemoveBtn: 'Remove',
        providerAdded: 'Provider added',
        providerRemoved: 'Provider removed',
        providerAlreadyAdded: 'This provider is already added.',
        providerLimitReached: 'The provider limit has been reached.',
        providerInvalidUrl: 'Enter a valid https:// URL.',
        permissionNotGranted: 'Not granted',
        permissionRequestError: 'Request failed',
    },
});
globalThis.browser = fake.browser;

await import('../src/options/components/providers-setting.js');

after(() => dom.teardown());

const manifestDoc = (resources) => ({
    schema_version: '0.1.0', name: 'Test provider', updated: '2026-09-14T00:00:00Z', resources
});
const site = (key, extra = {}) => ({ name: key, enabled: true, origins: [`https://${key}/*`], rules: [], ...extra });

/** Every origins list handed to permissions.request. */
let requests;
let respond;
let fetchMap;

const settled = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
    await fake.browser.storage.local.clear();
    await fake.browser.storage.sync.clear();
    requests = [];
    respond = async () => true;
    fetchMap = {};
    globalThis.browser.runtime.getManifest = () => WILDCARD_MANIFEST;
    globalThis.browser.permissions.request = ({ origins }) => {
        requests.push(origins);
        return respond();
    };
    globalThis.fetch = async (url) => {
        const key = String(url);
        const entry = fetchMap[key];
        if (entry === undefined) throw new Error(`unexpected fetch: ${key}`);
        if (entry instanceof Error) throw entry;
        return entry;
    };
    document.body.replaceChildren();
});

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200 });

/** Attach one instance and wait out its initial render. */
async function mount() {
    const el = document.createElement('providers-setting');
    document.body.append(el);
    await settled();
    return el;
}

const addForm = (el) => el.querySelector('.provider-add-form');
const urlInput = (el) => el.querySelector('.provider-url-input');
const addBtn = (el) => el.querySelector('.provider-add-btn');
const addError = (el) => el.querySelector('.provider-add-error');
const disclosure = (el) => el.querySelector('.provider-disclosure');
const confirmBtn = (el) => el.querySelector('.provider-confirm-btn');
const cancelBtn = (el) => el.querySelector('.provider-cancel-btn');
const rows = (el) => [...el.querySelectorAll('.provider-item')];

function record() {
    const seen = [];
    const fn = (e) => seen.push(e.detail);
    document.addEventListener('setting-saved', fn);
    return { seen, stop: () => document.removeEventListener('setting-saved', fn) };
}

describe('the empty and populated list', () => {
    test('shows the empty state with no providers', async () => {
        const el = await mount();
        assert.equal(rows(el).length, 0);
        assert.match(el.querySelector('.providers-empty').textContent, /No providers added yet/);
    });

    test('shows an added provider with its status', async () => {
        await fake.browser.storage.sync.set({ providers: [{ url: 'https://p.example/m.json', enabled: true }] });
        await fake.browser.storage.local.set({
            'provider:https://p.example/m.json': {
                siteConfigs: { 'news.example': site('news.example') },
                updated: Date.UTC(2026, 0, 1),
                rejected: [], errors: []
            }
        });

        const el = await mount();

        assert.equal(rows(el).length, 1);
        assert.equal(rows(el)[0].querySelector('.provider-url').textContent, 'https://p.example/m.json');
        assert.match(rows(el)[0].querySelector('.provider-status').textContent, /1 site/);
    });

    test('draws each switch in its stored state', async () => {
        await fake.browser.storage.sync.set({ providers: [
            { url: 'https://on.example/m.json', enabled: true },
            { url: 'https://off.example/m.json', enabled: false },
        ] });

        const el = await mount();

        assert.deepEqual(rows(el).map((row) => row.querySelector('toggle-button input').checked), [true, false]);
    });

    test('shows fetch errors apart from the status line', async () => {
        await fake.browser.storage.sync.set({ providers: [{ url: 'https://p.example/m.json', enabled: true }] });
        await fake.browser.storage.local.set({
            'provider:https://p.example/m.json': { siteConfigs: {}, rejected: [], errors: [{ message: 'HTTP 404' }] }
        });

        const el = await mount();

        const problems = rows(el)[0].querySelector('.provider-problems');
        assert.equal(problems.hidden, false);
        assert.equal(problems.textContent, 'HTTP 404');
        assert.doesNotMatch(rows(el)[0].querySelector('.provider-status').textContent, /404/);
    });
});

describe('the add flow', () => {
    const url = 'https://provider.example/manifest.json';

    test('the full round trip: inspect, disclose, confirm, resolve', async () => {
        fetchMap[url] = jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]));
        const el = await mount();
        urlInput(el).value = url;

        addBtn(el).click();
        await settled();

        // Gesture one requested the manifest's own origin only.
        assert.deepEqual(requests, [['https://provider.example/*']]);
        assert.equal(addForm(el).hidden, true);
        assert.equal(disclosure(el).hidden, false);
        assert.equal(disclosure(el).querySelector('.provider-disclosure-sites li').textContent, 'news.example (news.example)');

        const r = record();
        confirmBtn(el).click();
        await settled();

        assert.equal(requests.length, 1, 'an all-relative manifest requests nothing further');
        assert.deepEqual(r.seen, [{ key: 'providerAdded', value: url, success: true, message: 'Provider added' }]);
        r.stop();

        assert.deepEqual(await fake.browser.storage.sync.get('providers'), { providers: [{ url, enabled: true }] });
        assert.equal(disclosure(el).hidden, true);
        assert.equal(addForm(el).hidden, false);
        assert.equal(rows(el).length, 1);
    });

    test('a refused manifest-origin permission stops before inspect() is ever called', async () => {
        respond = async () => false;
        const el = await mount();
        urlInput(el).value = url;

        addBtn(el).click();
        await settled();

        assert.equal(disclosure(el).hidden, true);
        assert.match(addError(el).textContent, /Not granted/);
        assert.deepEqual(fetchMap, {}, 'nothing was ever fetched');
    });

    test('an inspect() error is shown inline and no disclosure opens', async () => {
        fetchMap[url] = new Response('', { status: 500 });
        const el = await mount();
        urlInput(el).value = url;

        addBtn(el).click();
        await settled();

        assert.equal(disclosure(el).hidden, true);
        assert.equal(addError(el).hidden, false);
    });

    test('cancel discards the pending add without persisting anything', async () => {
        fetchMap[url] = jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]));
        const el = await mount();
        urlInput(el).value = url;
        addBtn(el).click();
        await settled();

        cancelBtn(el).click();

        assert.equal(disclosure(el).hidden, true);
        assert.equal(urlInput(el).value, '');
        assert.deepEqual(await fake.browser.storage.sync.get('providers'), {});
    });

    test('a refused resource-origin permission at gesture two does not add the provider', async () => {
        fetchMap[url] = jsonResponse(manifestDoc([
            { type: 'rahti-data', href: 'https://data.example/data.json' }
        ]));
        const el = await mount();
        urlInput(el).value = url;
        addBtn(el).click();
        await settled();

        respond = async () => false;
        confirmBtn(el).click();
        await settled();

        assert.deepEqual(await fake.browser.storage.sync.get('providers'), {});
        assert.match(addError(el).textContent, /Not granted/);
    });

    test('never passes the wildcard origin to permissions.request', async () => {
        fetchMap[url] = jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]));
        const el = await mount();
        urlInput(el).value = url;
        addBtn(el).click();
        await settled();
        confirmBtn(el).click();
        await settled();

        for (const origins of requests) {
            assert.ok(!origins.includes(ARBITRARY_ORIGINS));
        }
    });

    test('requests both permissions while the click is still being handled, as Firefox requires', async () => {
        fetchMap[url] = jsonResponse(manifestDoc([
            { type: 'rahti-data', href: 'https://data.example/data.json' }
        ]));
        await fake.browser.storage.sync.set({ providers: [{ url: 'https://other.example/m.json', enabled: true }] });
        const el = await mount();

        // Firefox rejects a request made once the input handler has returned, e.g. after an await.
        let handlingInput = false;
        globalThis.browser.permissions.request = ({ origins }) => {
            if (!handlingInput) return Promise.reject(new Error('permissions.request may only be called from a user input handler'));
            requests.push(origins);
            return respond();
        };
        const userClick = (button) => {
            handlingInput = true;
            try { button.click(); } finally { handlingInput = false; }
        };

        urlInput(el).value = url;
        userClick(addBtn(el));
        await settled();
        assert.deepEqual(requests, [['https://provider.example/*']]);

        userClick(confirmBtn(el));
        await settled();
        assert.deepEqual(requests, [['https://provider.example/*'], ['https://data.example/*']]);
    });

    test('rejects a duplicate URL without requesting a permission', async () => {
        await fake.browser.storage.sync.set({ providers: [{ url, enabled: true }] });
        const el = await mount();
        urlInput(el).value = url;

        addBtn(el).click();
        await settled();

        assert.match(addError(el).textContent, /already added/);
        assert.deepEqual(requests, []);
    });

    test('rejects an invalid URL without requesting a permission', async () => {
        const el = await mount();
        urlInput(el).value = 'not a url';

        addBtn(el).click();
        await settled();

        assert.match(addError(el).textContent, /valid/);
        assert.deepEqual(requests, []);
    });
});

describe('an existing provider row', () => {
    const url = 'https://provider.example/manifest.json';

    test('the remove button removes it and re-renders', async () => {
        await fake.browser.storage.sync.set({ providers: [{ url, enabled: true }] });
        await fake.browser.storage.local.set({ [`provider:${url}`]: { siteConfigs: {}, rejected: [], errors: [] } });
        const el = await mount();

        rows(el)[0].querySelector('.provider-remove-btn').click();
        await settled();

        assert.equal(rows(el).length, 0);
        assert.deepEqual((await fake.browser.storage.sync.get('providers')).providers, []);
    });

    test('toggling the switch off disables the provider without removing it', async () => {
        await fake.browser.storage.sync.set({ providers: [{ url, enabled: true }] });
        await fake.browser.storage.local.set({ [`provider:${url}`]: { siteConfigs: {}, rejected: [], errors: [] } });
        const el = await mount();

        const toggleBtn = rows(el)[0].querySelector('toggle-button');
        toggleBtn.checked = false;
        toggleBtn.dispatchEvent(new CustomEvent('toggle-change', { detail: { checked: false } }));
        await settled();

        assert.deepEqual((await fake.browser.storage.sync.get('providers')).providers, [{ url, enabled: false }]);
    });
});

describe('the default-provider Remove-button guard', () => {
    const defaultUrl = 'https://default.example/manifest.json';
    const thirdPartyUrl = 'https://third-party.example/manifest.json';

    /** Sets the active ("free", the default test environment) environment's defaultProviders list. */
    async function setDefaultProviders(urls) {
        const data = await fake.browser.storage.local.get('userPreferences');
        const userPreferences = data.userPreferences || {};
        userPreferences.environmentConfigs = userPreferences.environmentConfigs || {};
        userPreferences.environmentConfigs.free = { ...userPreferences.environmentConfigs.free, defaultProviders: urls };
        await fake.browser.storage.local.set({ userPreferences });
    }

    test('a row whose URL is a current default provider has no Remove button, but keeps its toggle', async () => {
        await setDefaultProviders([defaultUrl]);
        await fake.browser.storage.sync.set({ providers: [{ url: defaultUrl, enabled: true }] });
        await fake.browser.storage.local.set({ [`provider:${defaultUrl}`]: { siteConfigs: {}, rejected: [], errors: [] } });

        const el = await mount();

        assert.equal(rows(el)[0].querySelector('.provider-remove-btn').hidden, true);
        assert.equal(rows(el)[0].querySelector('toggle-button').hidden, false);
    });

    test('a third-party row keeps its Remove button even while a default provider also exists', async () => {
        await setDefaultProviders([defaultUrl]);
        await fake.browser.storage.sync.set({
            providers: [{ url: defaultUrl, enabled: true }, { url: thirdPartyUrl, enabled: true }]
        });
        await fake.browser.storage.local.set({
            [`provider:${defaultUrl}`]: { siteConfigs: {}, rejected: [], errors: [] },
            [`provider:${thirdPartyUrl}`]: { siteConfigs: {}, rejected: [], errors: [] }
        });

        const el = await mount();

        const thirdPartyRow = rows(el).find((row) => row.querySelector('.provider-url').textContent === thirdPartyUrl);
        assert.equal(thirdPartyRow.querySelector('.provider-remove-btn').hidden, false);
    });

    test('a formerly-default URL no longer in defaultProviders regains its Remove button', async () => {
        await setDefaultProviders([]); // retired: no longer a default anywhere
        await fake.browser.storage.sync.set({ providers: [{ url: defaultUrl, enabled: true }] });
        await fake.browser.storage.local.set({ [`provider:${defaultUrl}`]: { siteConfigs: {}, rejected: [], errors: [] } });

        const el = await mount();

        assert.equal(rows(el)[0].querySelector('.provider-remove-btn').hidden, false);
    });
});

describe('a store build (no wildcard optional host permission)', () => {
    test('hides the add form but still lists an existing provider', async () => {
        globalThis.browser.runtime.getManifest = () => ({ optional_host_permissions: ['https://www.ampparit.com/*'] });
        await fake.browser.storage.sync.set({ providers: [{ url: 'https://p.example/m.json', enabled: true }] });
        await fake.browser.storage.local.set({ 'provider:https://p.example/m.json': { siteConfigs: {}, rejected: [], errors: [] } });

        const el = await mount();

        assert.equal(el.querySelector('.provider-add').hidden, true);
        assert.equal(rows(el).length, 1);
    });
});
