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

describe('removeProvider gives back what only that provider used', () => {
    const a = 'https://a.example/manifest.json';
    const b = 'https://b.example/manifest.json';
    const notFound = () => new Response('', { status: 404 });
    const manifestA = (resources = [
        { type: 'site-configs', sites: { 'news.example': site('news.example') } },
        { type: 'rahti-data', href: 'https://shared-cdn.example/a.json' },
        { type: 'rahti-data', href: 'https://a-cdn.example/data.json' }
    ]) => jsonResponse(manifestDoc(resources));

    const originalRemove = fake.browser.permissions.remove;
    const originalGetManifest = fake.browser.runtime.getManifest;
    let revoked;
    beforeEach(async () => {
        revoked = [];
        fake.browser.permissions.remove = async ({ origins }) => { revoked.push(...origins); return true; };

        await addProvider(a);
        await addProvider(b);
        installed = mockFetch({
            [a]: manifestA(),
            'https://shared-cdn.example/a.json': notFound(),
            'https://a-cdn.example/data.json': notFound(),
            [b]: jsonResponse(manifestDoc([{ type: 'rahti-data', href: 'https://shared-cdn.example/b.json' }])),
            'https://shared-cdn.example/b.json': notFound()
        });
        await refreshProviders();
        installed.restore();
        installed = null;
    });
    afterEach(() => {
        fake.browser.permissions.remove = originalRemove;
        fake.browser.runtime.getManifest = originalGetManifest;
    });

    test('revokes its manifest, resource and site origins, but not one another provider uses', async () => {
        await removeProvider(a);

        assert.deepEqual(revoked.sort(), ['https://a-cdn.example/*', 'https://a.example/*', 'https://news.example/*']);
    });

    test('does not try to revoke an origin the manifest requires', async () => {
        fake.browser.runtime.getManifest = () => ({ ...originalGetManifest(), host_permissions: ['https://a.example/some/path/*'] });

        await removeProvider(a);

        assert.ok(!revoked.includes('https://a.example/*'));
    });

    test('revokes a resource origin that its manifest stopped naming', async () => {
        installed = mockFetch({
            [a]: manifestA([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }])
        });
        await refreshProviders();

        await removeProvider(a);

        assert.ok(revoked.includes('https://a-cdn.example/*'));
    });

    test('drops the favicons of its sites under both spellings, and no others', async () => {
        await fake.browser.storage.local.set({
            'favicon_news.example': { data: 'x' },
            'favicon_www.news.example': { data: 'x' },
            'favicon_www.hs.fi': { data: 'x' }
        });

        await removeProvider(a);

        const left = await fake.browser.storage.local.get(null);
        assert.ok(!('favicon_news.example' in left));
        assert.ok(!('favicon_www.news.example' in left));
        assert.ok('favicon_www.hs.fi' in left);
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
        assert.equal(data.entryCount, 0);
        assert.equal(data.databaseGenerationDate, null);
        assert.deepEqual(data.resourceHeaders, {});
    });

    test('reads back entryCount and databaseGenerationDate written by refreshOne', async () => {
        const url = 'https://provider.example/manifest.json';
        const dataUrl = 'https://provider.example/data.json';
        await addProvider(url);
        installed = mockFetch({
            [url]: jsonResponse(manifestDoc([{ type: 'rahti-data', href: dataUrl }])),
            [dataUrl]: jsonResponse({
                schema_version: '0.1.0', updated: '2026-05-01T00:00:00Z',
                entries: [{ urls: [{ sign: 's1' }], title: 'x' }, { urls: [{ sign: 's2' }], title: 'y' }]
            })
        });

        await refreshProviders();

        const data = await getProviderData(url);
        assert.equal(data.entryCount, 2, 'matches Object.keys(rahtiData).length');
        assert.equal(data.databaseGenerationDate, '2026-05-01T00:00:00Z');
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

    describe('origins this browser has not granted', () => {
        const url = 'https://provider.example/manifest.json';
        const originalContains = fake.browser.permissions.contains;
        const denyHost = (host) => {
            fake.browser.permissions.contains = async ({ origins }) => !origins.includes(`https://${host}/*`);
        };
        afterEach(() => { fake.browser.permissions.contains = originalContains; });

        test('a provider whose manifest origin is not granted is not fetched at all', async () => {
            await addProvider(url);
            denyHost('provider.example');
            installed = mockFetch({});

            const results = await refreshProviders();

            assert.deepEqual(installed.calls, []);
            assert.match(results[0].error, /no access to https:\/\/provider\.example\/\*/);
        });

        test('a manifest that names a host not granted fetches no resource and keeps the last resolved content', async () => {
            await addProvider(url);
            installed = mockFetch({
                [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]))
            });
            await refreshProviders();
            installed.restore();

            denyHost('tracker.example');
            installed = mockFetch({
                [url]: jsonResponse(manifestDoc([{ type: 'rahti-data', href: 'https://tracker.example/data.json' }]))
            });
            const results = await refreshProviders();

            assert.deepEqual(installed.calls, [url]);
            assert.match(results[0].error, /no access to https:\/\/tracker\.example\/\*/);
            const data = await getProviderData(url);
            assert.ok(data.siteConfigs['news.example'], 'the last resolved content was discarded');
        });
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

    test('a default provider may replace the bundled set; a provider after it may not take the key back', async () => {
        const { DEFAULT_RAHTI_MANIFEST_URL: official } = await import('../src/config.js');
        const other = 'https://provider.example/manifest.json';
        await addProvider(official);
        await addProvider(other);
        installed = mockFetch({
            [official]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'yle.fi': site('yle.fi') } }])),
            [other]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'yle.fi': site('yle.fi') } }]))
        });

        await refreshProviders();

        const officialData = await getProviderData(official);
        assert.ok(officialData.siteConfigs['yle.fi'], 'shadowing is off by default, but the default provider publishes the bundled set');
        assert.deepEqual(officialData.rejected, []);
        assert.ok((await getProviderData(other)).rejected.some((r) => r.key === 'yle.fi'));
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

    test('two concurrent calls join into one pass instead of racing each other', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        installed = mockFetch({
            [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]))
        });

        const [first, second] = await Promise.all([refreshProviders(), refreshProviders()]);

        assert.equal(installed.calls.length, 1, 'the second call joined the first rather than starting its own pass');
        assert.deepEqual(first, second);
    });

    describe('refreshProviders({force}) vs. the single-flight guard', () => {
        test('a forced call issued while a non-forced pass is in-flight does not return its (possibly stale) results', async () => {
            const url = 'https://provider.example/manifest.json';
            await addProvider(url);
            installed = mockFetch({
                [url]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]))
            });

            // Both calls fire synchronously, back-to-back, before either has a chance to await anything
            // internally -- the same ordering the existing "two concurrent calls" test above relies on.
            const nonForced = refreshProviders();
            const forced = refreshProviders({ force: true });

            await Promise.all([nonForced, forced]);

            assert.equal(installed.calls.length, 2, 'the forced call started its own pass instead of joining the non-forced one');
        });

        test('three concurrent calls (one running, two forced) each get a distinct, sequential pass -- never running in parallel', async () => {
            const url = 'https://provider.example/manifest.json';
            await addProvider(url);
            let concurrentFetches = 0;
            let maxConcurrentFetches = 0;
            const original = globalThis.fetch;
            globalThis.fetch = async () => {
                concurrentFetches++;
                maxConcurrentFetches = Math.max(maxConcurrentFetches, concurrentFetches);
                await new Promise((resolve) => setTimeout(resolve, 5));
                concurrentFetches--;
                return jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }]));
            };
            installed = { restore: () => { globalThis.fetch = original; } };

            try {
                const [a, b, c] = await Promise.all([
                    refreshProviders(),
                    refreshProviders({ force: true }),
                    refreshProviders({ force: true })
                ]);
                assert.equal(maxConcurrentFetches, 1, 'two passes ran _refreshProviders() at once -- the single-flight guard was raced');
                assert.ok(a && b && c);
            } finally {
                installed.restore();
                installed = null;
            }
        });
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

    test('two concurrent calls join into one pass instead of racing each other', async () => {
        await seedProvider('https://a.example/manifest.json', { sites: [{ domain: 'a' }] });
        suola = mockSuola();

        await Promise.all([reconcileSuolaRules(), reconcileSuolaRules()]);

        assert.equal(suola.defineCalls.length, 1, 'the second call joined the first rather than starting its own pass');
    });
});

describe('a build that cannot add providers', () => {
    const synced = 'https://provider.example/manifest.json';
    const originalGetManifest = fake.browser.runtime.getManifest;
    let defaultUrl;
    beforeEach(async () => {
        ({ DEFAULT_RAHTI_MANIFEST_URL: defaultUrl } = await import('../src/config.js'));
        fake.browser.runtime.getManifest = () => ({ ...originalGetManifest(), optional_host_permissions: [] });
        await fake.browser.storage.sync.set({ providers: [{ url: defaultUrl, enabled: true }, { url: synced, enabled: true }] });
    });
    afterEach(() => { fake.browser.runtime.getManifest = originalGetManifest; });

    test('refreshes its default provider but not one that sync brought in', async () => {
        installed = mockFetch({ [defaultUrl]: jsonResponse(manifestDoc([])) });

        const results = await refreshProviders();

        assert.deepEqual(results.map((result) => result.url), [defaultUrl]);
        assert.deepEqual(installed.calls, [defaultUrl]);
    });
});
