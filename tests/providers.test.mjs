import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const {
    MAX_PROVIDERS, getProviders, addProvider, removeProvider, setProviderEnabled,
    getProviderData, refreshProviders, reconcileSuolaRules
} = await import('../src/providers.js');

/** Stubs the three Suola WASM globals reconcileSuolaRules() assumes are already installed. */
function mockSuola({ refuse = new Set() } = {}) {
    const defineCalls = [];
    const dropCalls = [];
    const defined = new Set();
    const originals = { defineRules: globalThis.defineRules, dropRules: globalThis.dropRules, listRules: globalThis.listRules };

    globalThis.defineRules = (name, json) => {
        defineCalls.push({ name, json });
        if (refuse.has(name)) return `refused: ${name}`;
        defined.add(name);
        return null;
    };
    globalThis.dropRules = (name) => {
        dropCalls.push(name);
        defined.delete(name);
    };
    globalThis.listRules = () => [...defined].sort();

    return {
        defineCalls, dropCalls, defined,
        restore: () => {
            globalThis.defineRules = originals.defineRules;
            globalThis.dropRules = originals.dropRules;
            globalThis.listRules = originals.listRules;
        }
    };
}

/** Replaces global fetch with a strict router: any URL not listed throws, so a stray fetch fails loudly. */
function mockFetch(map) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const key = String(url);
        calls.push(key);
        const entry = map[key];
        if (entry === undefined) throw new Error(`unexpected fetch: ${key}`);
        if (entry instanceof Error) throw entry;
        return entry;
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
}

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200 });

const manifestDoc = (resources) => ({
    schema_version: '0.1.0', name: 'Test provider', updated: '2026-09-14T00:00:00Z', resources
});
const site = (key, extra = {}) => ({ name: key, enabled: true, origins: [`https://${key}/*`], rules: [], ...extra });

let installed;
let suola;
beforeEach(async () => {
    await fake.browser.storage.local.clear();
    await fake.browser.storage.sync.clear();
});
afterEach(() => {
    if (installed) { installed.restore(); installed = null; }
    if (suola) { suola.restore(); suola = null; }
});

describe('the provider list', () => {
    test('starts empty', async () => {
        assert.deepEqual(await getProviders(), []);
    });

    test('addProvider appends, enabled by default', async () => {
        await addProvider('https://provider.example/manifest.json');
        assert.deepEqual(await getProviders(), [{ url: 'https://provider.example/manifest.json', enabled: true }]);
    });

    test('adding the same URL twice is a no-op', async () => {
        await addProvider('https://provider.example/manifest.json');
        await addProvider('https://provider.example/manifest.json');
        assert.equal((await getProviders()).length, 1);
    });

    test('rejects an unparsable URL', async () => {
        await assert.rejects(addProvider('not a url'));
        assert.deepEqual(await getProviders(), []);
    });

    test('refuses past the provider cap', async () => {
        for (let i = 0; i < MAX_PROVIDERS; i++) await addProvider(`https://provider.example/${i}.json`);
        await assert.rejects(addProvider('https://provider.example/one-too-many.json'), /At most/);
        assert.equal((await getProviders()).length, MAX_PROVIDERS);
    });

    test('setProviderEnabled toggles without losing the provider', async () => {
        await addProvider('https://provider.example/manifest.json');
        await setProviderEnabled('https://provider.example/manifest.json', false);
        assert.deepEqual(await getProviders(), [{ url: 'https://provider.example/manifest.json', enabled: false }]);
    });

    test('removeProvider drops it from the list and prunes its local data', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        await fake.browser.storage.local.set({ [`provider:${url}`]: { siteConfigs: { x: {} } } });

        await removeProvider(url);

        assert.deepEqual(await getProviders(), []);
        const stored = await fake.browser.storage.local.get(`provider:${url}`);
        assert.equal(stored[`provider:${url}`], undefined);
    });

    test('removing a provider does not touch another whose URL it is a prefix of', async () => {
        const short = 'https://provider.example/m.json';
        const long = 'https://provider.example/m.json.bak';
        await addProvider(short);
        await addProvider(long);
        await fake.browser.storage.local.set({
            [`provider:${short}`]: { siteConfigs: { a: {} } },
            [`provider:${long}`]: { siteConfigs: { b: {} } }
        });

        await removeProvider(short);

        assert.deepEqual(await getProviders(), [{ url: long, enabled: true }]);
        const data = await getProviderData(long);
        assert.deepEqual(data.siteConfigs, { b: {} }, 'the longer provider\'s data survived the shorter one\'s removal');
    });
});

describe('getProviderData', () => {
    test('returns the empty shape for a provider that has never resolved', async () => {
        const data = await getProviderData('https://provider.example/manifest.json');
        assert.deepEqual(data.siteConfigs, {});
        assert.deepEqual(data.rahtiData, {});
        assert.equal(data.suolaRules, null);
        assert.deepEqual([...data.scope], []);
        assert.equal(data.updated, null);
    });
});

describe('refreshProviders', () => {
    test('skips a disabled provider entirely', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        await setProviderEnabled(url, false);
        installed = mockFetch({});

        const results = await refreshProviders();

        assert.deepEqual(results, []);
        assert.deepEqual(installed.calls, []);
    });

    test('resolves an enabled provider and persists its data', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        installed = mockFetch({
            [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]))
        });

        const results = await refreshProviders();

        assert.equal(results.length, 1);
        assert.equal(results[0].error, undefined);
        const data = await getProviderData(url);
        assert.ok(data.siteConfigs['news.example']);
        assert.ok(data.updated);
    });

    test('a manifest fetch failure keeps the last resolved content and records the error', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);

        installed = mockFetch({
            [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]))
        });
        await refreshProviders();
        installed.restore();

        installed = mockFetch({ [url]: new Response('', { status: 500 }) });
        const results = await refreshProviders();

        assert.match(results[0].error, /HTTP 500/);
        const data = await getProviderData(url);
        assert.ok(data.siteConfigs['news.example'], 'stale content was discarded on a transient failure');
        assert.equal(data.errors.length, 1);
        assert.match(data.errors[0].message, /HTTP 500/);
    });

    test('a failure in one provider does not touch another provider\'s data', async () => {
        const good = 'https://good.example/manifest.json';
        const bad = 'https://bad.example/manifest.json';
        await addProvider(good);
        await addProvider(bad);
        installed = mockFetch({
            [good]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }])),
            [bad]: new Response('', { status: 500 })
        });

        await refreshProviders();

        const goodData = await getProviderData(good);
        const badData = await getProviderData(bad);
        assert.ok(goodData.siteConfigs['news.example']);
        assert.deepEqual(badData.siteConfigs, {});
    });

    test('the bundled set is claimed before the first provider runs', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        installed = mockFetch({
            [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'yle.fi': site('yle.fi') } }]))
        });

        await refreshProviders();

        const data = await getProviderData(url);
        assert.deepEqual(data.siteConfigs, {}, 'yle.fi is a bundled site and shadowing is off by default');
        assert.ok(data.rejected.some((r) => r.key === 'yle.fi'));
    });

    test('a provider does not shadow its own prior claim on a second refresh', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        installed = mockFetch({
            [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'extra.example': site('extra.example') } }]))
        });

        for (let round = 1; round <= 3; round++) {
            await refreshProviders();
            const data = await getProviderData(url);
            assert.ok(data.siteConfigs['extra.example'], `lost after refresh round ${round}`);
            assert.deepEqual(data.rejected, [], `round ${round} rejected its own prior claim`);
        }
    });

    test('claims accumulate across providers in the order they were added', async () => {
        const first = 'https://first.example/manifest.json';
        const second = 'https://second.example/manifest.json';
        await addProvider(first);
        await addProvider(second);
        installed = mockFetch({
            [first]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }])),
            [second]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]))
        });

        await refreshProviders();

        const firstData = await getProviderData(first);
        const secondData = await getProviderData(second);
        assert.ok(firstData.siteConfigs['news.example'], 'the first provider to add a new key wins it');
        assert.equal(secondData.siteConfigs['news.example'], undefined);
        assert.ok(secondData.rejected.some((r) => r.key === 'news.example'));
    });
});

describe('reconcileSuolaRules', () => {
    async function seedProvider(url, suolaRules) {
        await addProvider(url);
        await fake.browser.storage.local.set({ [`provider:${url}`]: { suolaRules } });
    }

    test('defines a named set for each enabled provider with rules', async () => {
        await seedProvider('https://a.example/manifest.json', { sites: [{ domain: 'a' }] });
        suola = mockSuola();

        await reconcileSuolaRules();

        assert.equal(suola.defineCalls.length, 1);
        assert.equal(suola.defineCalls[0].name, 'https://a.example/manifest.json');
        assert.deepEqual(JSON.parse(suola.defineCalls[0].json), { sites: [{ domain: 'a' }] });
    });

    test('skips a disabled provider and one with no resolved rules', async () => {
        await seedProvider('https://disabled.example/manifest.json', { sites: [{ domain: 'a' }] });
        await setProviderEnabled('https://disabled.example/manifest.json', false);
        await seedProvider('https://norules.example/manifest.json', null);
        suola = mockSuola();

        await reconcileSuolaRules();

        assert.deepEqual(suola.defineCalls, []);
    });

    test('drops a name no longer backed by an active provider', async () => {
        suola = mockSuola();
        globalThis.defineRules('https://gone.example/manifest.json', '{"sites":[]}');
        assert.ok(suola.defined.has('https://gone.example/manifest.json'));

        await reconcileSuolaRules();

        assert.deepEqual(suola.dropCalls, ['https://gone.example/manifest.json']);
    });

    test('a refused defineRules call is not counted as active and does not stop the others', async () => {
        await seedProvider('https://bad.example/manifest.json', { sites: 'not an array' });
        await seedProvider('https://good.example/manifest.json', { sites: [{ domain: 'a' }] });
        suola = mockSuola({ refuse: new Set(['https://bad.example/manifest.json']) });

        await reconcileSuolaRules();

        assert.ok(!suola.defined.has('https://bad.example/manifest.json'));
        assert.ok(suola.defined.has('https://good.example/manifest.json'));
    });

    test('removing a provider drops its named set on the next reconcile', async () => {
        const url = 'https://provider.example/manifest.json';
        await seedProvider(url, { sites: [{ domain: 'a' }] });
        suola = mockSuola();
        await reconcileSuolaRules();
        assert.ok(suola.defined.has(url));

        await removeProvider(url);
        await reconcileSuolaRules();

        assert.ok(!suola.defined.has(url));
        assert.ok(suola.dropCalls.includes(url));
    });

    test('never throws: a storage failure reading the provider list degrades to a no-op', async () => {
        const originalGet = fake.browser.storage.sync.get;
        fake.browser.storage.sync.get = async () => { throw new Error('storage unavailable'); };
        suola = mockSuola();

        try {
            await assert.doesNotReject(reconcileSuolaRules());
        } finally {
            fake.browser.storage.sync.get = originalGet;
        }
    });

    test('one provider\'s storage failure does not stop another from being installed', async () => {
        await seedProvider('https://good.example/manifest.json', { sites: [{ domain: 'a' }] });
        await addProvider('https://bad.example/manifest.json');
        suola = mockSuola();

        const originalGet = fake.browser.storage.local.get;
        fake.browser.storage.local.get = async (query) => {
            if (String(query).includes('bad.example')) throw new Error('storage unavailable');
            return originalGet(query);
        };

        try {
            await assert.doesNotReject(reconcileSuolaRules());
            assert.ok(suola.defined.has('https://good.example/manifest.json'));
        } finally {
            fake.browser.storage.local.get = originalGet;
        }
    });

    test('a throwing listRules does not stop defineRules from having run', async () => {
        await seedProvider('https://a.example/manifest.json', { sites: [{ domain: 'a' }] });
        suola = mockSuola();
        globalThis.listRules = () => { throw new Error('listRules exploded'); };

        await assert.doesNotReject(reconcileSuolaRules());

        assert.equal(suola.defineCalls.length, 1);
    });
});
