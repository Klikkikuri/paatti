import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const GITHUB = 'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json';
const GITHUB_PATTERN = `${GITHUB}*`;
const LOCALHOST = 'http://localhost:3000/data.json';
const LOCALHOST_PATTERN = 'http://localhost/data.json*';
const WILDCARD_MANIFEST = { optional_host_permissions: ['https://www.ampparit.com/*', '*://*/*'] };

const dom = installDom();
const fake = createFakeBrowser({
    local: { userPreferences: { environmentConfigs: { development: { titleDataUrls: [GITHUB, LOCALHOST] } } } },
    messages: {
        requestDatasourcePermissionBtn: 'Request access',
        datasourcePermissionGranted: 'Access granted',
        datasourcePermissionMissing: 'No permission for $1',
        permissionNotGranted: 'Not granted',
        permissionRequestError: 'Request failed',
    },
});
globalThis.browser = fake.browser;

await import('../src/options/components/datasource-permission-setting.js');

after(() => dom.teardown());

/** Patterns the browser reports as granted. The GitHub default is covered by host_permissions. */
let covered;
/** Every origins list handed to permissions.request. */
let requests;
let respond;

beforeEach(() => {
    covered = new Set([GITHUB_PATTERN]);
    requests = [];
    respond = async () => true;
    globalThis.browser.runtime.getManifest = () => WILDCARD_MANIFEST;
    globalThis.browser.permissions.contains = async ({ origins: [pattern] }) => covered.has(pattern);
    globalThis.browser.permissions.request = ({ origins }) => {
        requests.push(origins);
        return respond();
    };
    document.body.replaceChildren();
});

const settled = () => new Promise((r) => setTimeout(r, 0));

/** Attach one instance and wait out its first permission check. */
async function mount() {
    const el = document.createElement('datasource-permission-setting');
    document.body.append(el);
    await settled();
    return el;
}

const button = (el) => el.querySelector('button');
const warning = (el) => el.querySelector('.datasource-permission-warning');

/** Collect the setting-saved events that reach the document. */
function record() {
    const seen = [];
    const fn = (e) => seen.push(e.detail);
    document.addEventListener('setting-saved', fn);
    return { seen, stop: () => document.removeEventListener('setting-saved', fn) };
}

describe('what the element shows', () => {
    test('the button is disabled until the check is done, then enabled while something is missing', async () => {
        const el = document.createElement('datasource-permission-setting');
        document.body.append(el);
        assert.equal(button(el).disabled, true);
        assert.equal(button(el).textContent, 'Request access');
        assert.equal(warning(el).hidden, true);

        await settled();
        assert.equal(button(el).disabled, false);
    });

    test('the warning names what is missing', async () => {
        const el = await mount();
        assert.equal(warning(el).hidden, false);
        assert.equal(warning(el).textContent, `No permission for ${LOCALHOST_PATTERN}`);
    });

    test('nothing missing: warning hidden, button disabled, a click requests nothing', async () => {
        covered.add(LOCALHOST_PATTERN);
        const el = await mount();

        assert.equal(warning(el).hidden, true);
        assert.equal(button(el).disabled, true);
        button(el).click();
        await settled();
        assert.deepEqual(requests, []);
    });

    test('a failed check leaves the button disabled', async () => {
        globalThis.browser.permissions.contains = async () => { throw new Error('no permissions API'); };
        const error = console.error;
        console.error = () => {};
        try {
            const el = await mount();
            assert.equal(button(el).disabled, true);
        } finally {
            console.error = error;
        }
    });

    test('a saved list is re-checked', async () => {
        const el = await mount();
        assert.equal(button(el).disabled, false);

        const { local } = globalThis.browser.storage;
        await local.set({ userPreferences: { environmentConfigs: { development: { titleDataUrls: [GITHUB] } } } });
        await settled();
        assert.equal(button(el).disabled, true);
        assert.equal(warning(el).hidden, true);

        await local.set({ userPreferences: { environmentConfigs: { development: { titleDataUrls: [GITHUB, LOCALHOST] } } } });
        await settled();
        assert.equal(button(el).disabled, false);
        assert.equal(warning(el).hidden, false);
    });
});

describe('the button', () => {
    test('requests every pattern of the saved list; the browser skips what it holds', async () => {
        const el = await mount();
        button(el).click();
        await settled();

        assert.deepEqual(requests, [[GITHUB_PATTERN, LOCALHOST_PATTERN]]);
    });

    test('a grant is announced and the element re-checks', async () => {
        const el = await mount();
        const r = record();
        respond = async () => {
            covered.add(LOCALHOST_PATTERN);
            return true;
        };

        button(el).click();
        await settled();

        assert.deepEqual(r.seen, [
            { key: 'datasourcePermission', value: [GITHUB, LOCALHOST], success: true, message: 'Access granted' },
        ]);
        assert.equal(button(el).disabled, true);
        assert.equal(warning(el).hidden, true);
        r.stop();
    });

    test('a refusal is announced and the button stays available', async () => {
        respond = async () => false;
        const el = await mount();
        const r = record();

        button(el).click();
        await settled();

        assert.deepEqual(r.seen, [
            { key: 'datasourcePermission', value: [GITHUB, LOCALHOST], success: false, message: 'Not granted' },
        ]);
        assert.equal(button(el).disabled, false);
        r.stop();
    });

    test('a request the browser rejected is announced', async () => {
        respond = async () => { throw new Error('not declared'); };
        const el = await mount();
        const r = record();

        button(el).click();
        await settled();

        assert.deepEqual(r.seen, [
            { key: 'datasourcePermission', value: [GITHUB, LOCALHOST], success: false, message: 'Request failed' },
        ]);
        r.stop();
    });

    test('a click during a pending request is ignored, also after a re-check', async () => {
        let release;
        respond = () => new Promise((r) => { release = r; });
        const el = await mount();

        button(el).click();
        button(el).click();
        assert.equal(button(el).disabled, true);

        // A save while the prompt is open re-checks; the button must stay disabled.
        const { local } = globalThis.browser.storage;
        await local.set({ userPreferences: { environmentConfigs: { development: { titleDataUrls: [LOCALHOST, GITHUB] } } } });
        await settled();
        assert.equal(button(el).disabled, true);

        release(false);
        await settled();
        assert.equal(requests.length, 1);
        assert.equal(button(el).disabled, false);

        await local.set({ userPreferences: { environmentConfigs: { development: { titleDataUrls: [GITHUB, LOCALHOST] } } } });
        await settled();
    });
});

describe('request(urls), for the save button', () => {
    test('requests the patterns of the given URLs and announces nothing itself', async () => {
        const el = await mount();
        const r = record();

        const granted = await el.request(['http://other.test:8080/db.json?x=1']);
        await settled();

        assert.equal(granted, true);
        assert.deepEqual(requests, [['http://other.test/db.json*']]);
        assert.deepEqual(r.seen, []);
        r.stop();
    });

    test('a refusal resolves false, announces nothing, and the element re-checks', async () => {
        respond = async () => false;
        const el = await mount();
        const r = record();

        assert.equal(await el.request([LOCALHOST]), false);
        await settled();

        assert.deepEqual(r.seen, []);
        assert.equal(button(el).disabled, false);
        assert.equal(warning(el).hidden, false);
        r.stop();
    });

    test('a second request while one is pending is refused without calling the browser', async () => {
        let release;
        respond = () => new Promise((r) => { release = r; });
        const el = await mount();

        const first = el.request([LOCALHOST]);
        assert.equal(el.request([LOCALHOST]), null);
        assert.equal(requests.length, 1);

        release(true);
        assert.equal(await first, true);
        await settled();
        assert.notEqual(el.request([LOCALHOST]), null);
    });

    test('a rejected request rejects the caller and still re-checks', async () => {
        respond = async () => { throw new Error('not declared'); };
        const el = await mount();

        await assert.rejects(el.request([LOCALHOST]), /not declared/);
        await settled();
        assert.equal(button(el).disabled, false);
    });
});

describe('a manifest without the wildcard', () => {
    test('hides the button, keeps the warning, and request() returns null', async () => {
        for (const manifest of [{ optional_host_permissions: ['https://www.ampparit.com/*'] }, {}]) {
            globalThis.browser.runtime.getManifest = () => manifest;
            const el = await mount();

            assert.equal(el.hidden, false);
            assert.equal(button(el).hidden, true);
            assert.equal(warning(el).hidden, false);
            assert.equal(el.request([LOCALHOST]), null);
            assert.deepEqual(requests, []);
        }
    });
});

describe('a detached element', () => {
    test('requests nothing on a click', async () => {
        const el = await mount();
        el.remove();

        button(el).click();
        await settled();
        assert.deepEqual(requests, []);
    });
});
