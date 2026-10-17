import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const {
    MAX_PROVIDERS, getProviders, addProvider, seedDefaultProviders, removeProvider, setProviderEnabled,
    getProviderData, dropStaleProviderData, namespaceFor, refreshProviders, reconcileSuolaRules, retryDelayMs
} = await import('../src/providers.js');
const { initStorage } = await import('../src/storage.js');

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

    describe('seedDefaultProviders puts the defaults first, in their own order', () => {
        const [A, B, X, Y] = ['a', 'b', 'x', 'y'].map((name) => `https://${name}.example/manifest.json`);
        const on = (url) => ({ url, enabled: true });
        const cases = [
            { name: 'adds a missing default in front of a third-party provider', list: [on(X)], defaults: [A], expected: [on(A), on(X)] },
            { name: 'moves a default that was added later', list: [on(X), on(A), on(Y)], defaults: [A], expected: [on(A), on(X), on(Y)] },
            { name: 'keeps a disabled default disabled', list: [on(X), { url: A, enabled: false }], defaults: [A], expected: [{ url: A, enabled: false }, on(X)] },
            { name: 'orders several defaults as listed', list: [on(B), on(X)], defaults: [A, B], expected: [on(A), on(B), on(X)] },
            { name: 'keeps a former default as an ordinary provider', list: [on(B), on(X)], defaults: [A], expected: [on(A), on(B), on(X)] },
        ];
        for (const { name, list, defaults, expected } of cases) {
            test(name, async () => {
                await fake.browser.storage.sync.set({ providers: list });
                assert.deepEqual(await seedDefaultProviders(defaults), expected);
                assert.deepEqual(await getProviders(), expected);
            });
        }

        test('does not write a list that is already in order', async () => {
            await fake.browser.storage.sync.set({ providers: [on(A), on(X)] });
            let writes = 0;
            const listener = (changes, area) => { if (area === 'sync') writes++; };
            fake.browser.storage.onChanged.addListener(listener);
            try {
                await seedDefaultProviders([A]);
            } finally {
                fake.browser.storage.onChanged.removeListener(listener);
            }
            assert.equal(writes, 0);
        });

        test('adds no default past the provider cap', async () => {
            const full = Array.from({ length: MAX_PROVIDERS }, (_, i) => on(`https://provider.example/${i}.json`));
            await fake.browser.storage.sync.set({ providers: full });
            assert.deepEqual(await seedDefaultProviders([A]), full);
        });
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
    const emptyRahti = () => jsonResponse({ schema_version: '0.1.0', entries: [] });
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
            'https://shared-cdn.example/a.json': emptyRahti(),
            'https://a-cdn.example/data.json': emptyRahti(),
            [b]: jsonResponse(manifestDoc([{ type: 'rahti-data', href: 'https://shared-cdn.example/b.json' }])),
            'https://shared-cdn.example/b.json': emptyRahti()
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

    test('revokes an origin its last refresh stopped on, which a grant may have given since', async () => {
        const originalContains = fake.browser.permissions.contains;
        fake.browser.permissions.contains = async ({ origins }) => !origins.includes('https://new-cdn.example/*');
        installed = mockFetch({ [a]: manifestA([{ type: 'rahti-data', href: 'https://new-cdn.example/data.json' }]) });
        await refreshProviders();
        fake.browser.permissions.contains = originalContains;

        await removeProvider(a);

        assert.ok(revoked.includes('https://new-cdn.example/*'));
    });

    test('revokes a resource origin that its manifest stopped naming', async () => {
        installed = mockFetch({
            [a]: manifestA([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }])
        });
        await refreshProviders();

        await removeProvider(a);

        assert.ok(revoked.includes('https://a-cdn.example/*'));
    });

    test('removes its document cache', async () => {
        await removeProvider(a);

        const key = `provider:${a}_documents`;
        assert.ok(!(key in await fake.browser.storage.local.get(key)));
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

describe('dropStaleProviderData', () => {
    test('removes the scope and the rejected list that an older version stored, and nothing else', async () => {
        const url = 'https://provider.example/manifest.json';
        await addProvider(url);
        const storage = await initStorage(namespaceFor(url));
        await storage.store({
            scope: ['news.example'], rejected: [{ key: 'yle.fi', reason: 'already claimed; shadowing is disabled' }],
            siteConfigs: { 'news.example': site('news.example') }
        });

        await dropStaleProviderData();

        const data = await getProviderData(url);
        assert.deepEqual(data.rejected, []);
        assert.ok(data.siteConfigs['news.example']);
        assert.ok(!(await initStorage(namespaceFor(url))).getKeys().includes('scope'));
    });
});

describe('getProviderData', () => {
    test('returns the empty shape for a provider that has never resolved', async () => {
        const data = await getProviderData('https://provider.example/manifest.json');
        assert.deepEqual(data.siteConfigs, {});
        assert.deepEqual(data.rahtiData, {});
        assert.equal(data.suolaRules, null);
        assert.deepEqual(data.siteWeights, {});
        assert.equal(data.updated, null);
        assert.equal(data.entryCount, 0);
        assert.equal(data.databaseGenerationDate, null);
        assert.equal(data.checked, null);
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
    test('a provider whose refresh throws does not stop the providers after it', async () => {
        const first = 'https://first.example/manifest.json';
        const second = 'https://second.example/manifest.json';
        await addProvider(first);
        await addProvider(second);
        installed = mockFetch({ [first]: jsonResponse(manifestDoc([])), [second]: jsonResponse(manifestDoc([])) });
        const originalSet = fake.browser.storage.local.set;
        fake.browser.storage.local.set = async (items) => {
            if (Object.keys(items).some((key) => key.includes(first))) throw new Error('QUOTA_BYTES quota exceeded');
            return originalSet.call(fake.browser.storage.local, items);
        };

        let results;
        try {
            results = await refreshProviders();
        } finally {
            fake.browser.storage.local.set = originalSet;
        }

        assert.deepEqual(results.map((result) => result.url), [first, second]);
        assert.match(results[0].error, /quota/);
        assert.equal(results[1].error, undefined);
    });

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
        assert.equal(results[0].transient, true);
        const data = await getProviderData(url);
        assert.ok(data.siteConfigs['news.example'], 'stale content was discarded on a transient failure');
        assert.equal(data.errors.length, 1);
        assert.match(data.errors[0].message, /HTTP 500/);
        assert.equal(data.errors[0].kind, 'fetch');
    });

    describe('a failed resource fetch', () => {
        const url = 'https://provider.example/manifest.json';
        const a = 'https://provider.example/a.json';
        const b = 'https://provider.example/b.json';
        const sitesUrl = 'https://provider.example/sites.json';
        const documentsKey = `provider:${url}_documents`;
        const rahti = (sign, title) => jsonResponse({ schema_version: '0.1.0', entries: [{ urls: [{ sign }], title }] });
        const manifest = (resources) => jsonResponse(manifestDoc(resources));
        const RAHTI_AB = [{ type: 'rahti-data', href: a }, { type: 'rahti-data', href: b }];
        const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

        /** Refresh with `first`, then with `second`; each maps URL to a response factory. */
        async function refreshTwice(first, second) {
            await addProvider(url);
            installed = mockFetch(Object.fromEntries(Object.entries(first).map(([key, make]) => [key, make()])));
            await refreshProviders();
            installed.restore();
            const before = await getProviderData(url);
            await tick();
            installed = mockFetch(Object.fromEntries(Object.entries(second).map(([key, make]) => [key, make()])));
            const results = await refreshProviders();
            return { before, results, data: await getProviderData(url) };
        }

        test('a temporary failure keeps that file\'s entries, stores the fresh ones and does not move updated', async () => {
            const { before, results, data } = await refreshTwice(
                { [url]: () => manifest(RAHTI_AB), [a]: () => rahti('sa', 'old-a'), [b]: () => rahti('sb', 'old-b') },
                { [url]: () => manifest(RAHTI_AB), [a]: () => rahti('sa', 'new-a'), [b]: () => new Response('', { status: 429 }) }
            );

            assert.equal(results[0].error, `${b}: HTTP 429`);
            assert.equal(results[0].transient, true);
            assert.equal(data.rahtiData.sa.title, 'new-a');
            assert.equal(data.rahtiData.sb.title, 'old-b');
            assert.equal(data.updated, before.updated);
            assert.ok(data.checked > before.checked);
        });

        test('fetch errors come before the other errors', async () => {
            const invalid = 'https://provider.example/invalid.json';
            const resources = [...RAHTI_AB, { type: 'rahti-data', href: invalid }];
            const { data } = await refreshTwice(
                { [url]: () => manifest(resources), [a]: () => rahti('sa', 'x'), [b]: () => rahti('sb', 'y'), [invalid]: () => jsonResponse({}) },
                { [url]: () => manifest(resources), [a]: () => rahti('sa', 'x'), [b]: () => new Response('', { status: 503 }), [invalid]: () => jsonResponse({}) }
            );

            assert.equal(data.errors[0].kind, 'fetch');
            assert.match(data.errors[1].message, /not a rahti-data document/);
        });

        test('a permanent failure drops that file\'s entries', async () => {
            const { results, data } = await refreshTwice(
                { [url]: () => manifest(RAHTI_AB), [a]: () => rahti('sa', 'old-a'), [b]: () => rahti('sb', 'old-b') },
                { [url]: () => manifest(RAHTI_AB), [a]: () => rahti('sa', 'new-a'), [b]: () => new Response('', { status: 404 }) }
            );

            assert.equal(results[0].transient, false);
            assert.equal(data.rahtiData.sa.title, 'new-a');
            assert.equal(data.rahtiData.sb, undefined);
        });

        test('a temporary site-configs failure keeps the provider\'s sites', async () => {
            const resources = [{ type: 'site-configs', href: sitesUrl }];
            const { data } = await refreshTwice(
                { [url]: () => manifest(resources), [sitesUrl]: () => jsonResponse({ schema_version: '0.1.0', sites: { 'news.example': site('news.example') } }) },
                { [url]: () => manifest(resources), [sitesUrl]: () => new TypeError('fetch failed') }
            );

            assert.ok(data.siteConfigs['news.example']);
            assert.equal(data.errors[0].kind, 'fetch');
        });

        test('a first refresh with one of two files failing stores the other file\'s entries', async () => {
            await addProvider(url);
            installed = mockFetch({ [url]: manifest(RAHTI_AB), [a]: rahti('sa', 'x'), [b]: new Response('', { status: 503 }) });

            await refreshProviders();

            const data = await getProviderData(url);
            assert.equal(data.rahtiData.sa.title, 'x');
            assert.equal(data.updated, null);
            assert.ok(data.checked);
        });

        test('the documents key is not written when every file answers 304', async () => {
            const writes = [];
            const originalSet = fake.browser.storage.local.set;
            fake.browser.storage.local.set = async (items) => { writes.push(...Object.keys(items)); return originalSet(items); };
            try {
                await refreshTwice(
                    { [url]: () => manifest(RAHTI_AB), [a]: () => rahti('sa', 'x'), [b]: () => rahti('sb', 'y') },
                    { [url]: () => manifest(RAHTI_AB), [a]: () => new Response(null, { status: 304 }), [b]: () => new Response(null, { status: 304 }) }
                );
            } finally {
                fake.browser.storage.local.set = originalSet;
            }

            assert.equal(writes.filter((key) => key === documentsKey).length, 1);
        });

        describe('data stored before the document cache', () => {
            const ns = `provider:${url}`;
            beforeEach(async () => {
                await addProvider(url);
                const data = { rahtiData: { sa: { title: 'stored' } }, resourceHeaders: { [a]: { etag: '"v1"' } }, updated: 1 };
                await fake.browser.storage.local.set({ [ns]: data, [`${ns}_index`]: Object.keys(data) });
            });

            test('a temporary failure keeps the stored entries', async () => {
                installed = mockFetch({ [url]: manifest(RAHTI_AB), [a]: new Response('', { status: 503 }), [b]: rahti('sb', 'y') });

                const results = await refreshProviders();

                assert.equal(results[0].transient, true);
                const data = await getProviderData(url);
                assert.equal(data.rahtiData.sa.title, 'stored');
                assert.equal(data.updated, 1);
            });

            test('a successful refresh fetches in full and drops resourceHeaders', async () => {
                installed = mockFetch({ [url]: manifest(RAHTI_AB), [a]: rahti('sa', 'fresh'), [b]: rahti('sb', 'y') });

                await refreshProviders();

                const stored = (await fake.browser.storage.local.get(ns))[ns];
                assert.equal(stored.rahtiData.sa.title, 'fresh');
                assert.ok(!('resourceHeaders' in stored));
                assert.ok((await fake.browser.storage.local.get(documentsKey))[documentsKey][a]);
            });
        });
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
            const [error] = (await getProviderData(url)).errors;
            assert.equal(error.kind, 'access');
            assert.deepEqual(error.origins, ['https://provider.example/*']);
        });

        test('stores the manifest name and links before it stops on a resource origin', async () => {
            await addProvider(url);
            denyHost('tracker.example');
            installed = mockFetch({
                [url]: jsonResponse({
                    ...manifestDoc([{ type: 'rahti-data', href: 'https://tracker.example/data.json' }]),
                    links: [{ rel: 'privacy-policy', href: 'https://provider.example/privacy' }, { rel: 'about', href: 'javascript:alert(1)' }]
                })
            });

            await refreshProviders();

            const data = await getProviderData(url);
            assert.equal(data.name, 'Test provider');
            assert.deepEqual(data.links, [{ rel: 'privacy-policy', href: 'https://provider.example/privacy' }]);
            assert.deepEqual(data.errors[0].origins, ['https://tracker.example/*']);
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

    test('every provider keeps the sites it supplies; which one wins is decided by the configuration', async () => {
        const first = 'https://first.example/manifest.json';
        const second = 'https://second.example/manifest.json';
        await addProvider(first);
        await addProvider(second);
        installed = mockFetch({
            [first]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'news.example': site('news.example') } }])),
            [second]: jsonResponse(manifestDoc([{ type: 'site-configs', weight: 3, sites: { 'news.example': site('news.example') } }]))
        });

        await refreshProviders();

        assert.deepEqual(Object.keys((await getProviderData(first)).siteConfigs), ['news.example']);
        const secondData = await getProviderData(second);
        assert.deepEqual(Object.keys(secondData.siteConfigs), ['news.example']);
        assert.deepEqual(secondData.siteWeights, { 'news.example': 3 });
        assert.deepEqual(secondData.rejected, []);
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

describe('retryDelayMs', () => {
    const DEFAULT = 'https://default.example/manifest.json';
    const OTHER = 'https://other.example/manifest.json';
    const DEFAULT_URLS = new Set([DEFAULT]);
    const HOUR = 60 * 60 * 1000;
    const temporary = (url, extra = {}) => ({ url, error: 'HTTP 503', transient: true, ...extra });

    const CASES = [
        { name: 'no default provider result', results: [], attempt: 1, expected: null },
        { name: 'a success', results: [{ url: DEFAULT }], attempt: 1, expected: null },
        { name: 'a permanent error', results: [temporary(DEFAULT, { transient: false })], attempt: 1, expected: null },
        { name: 'a temporary error of another provider', results: [temporary(OTHER)], attempt: 1, expected: null },
        { name: 'attempt 1', results: [temporary(DEFAULT)], attempt: 1, expected: 30000 },
        { name: 'attempt 2', results: [temporary(DEFAULT)], attempt: 2, expected: 60000 },
        { name: 'attempt 3', results: [temporary(DEFAULT)], attempt: 3, expected: null },
        { name: 'a Retry-After longer than the backoff', results: [temporary(DEFAULT, { retryAfterMs: 40000 })], attempt: 1, expected: 40000 },
        { name: 'a Retry-After shorter than the backoff', results: [temporary(DEFAULT, { retryAfterMs: 1000 })], attempt: 2, expected: 60000 },
        { name: 'a Retry-After longer than the interval', results: [temporary(DEFAULT, { retryAfterMs: 2 * HOUR })], attempt: 1, expected: null },
        { name: 'a backoff longer than the interval', results: [temporary(DEFAULT)], attempt: 2, intervalMs: 45000, expected: 45000 }
    ];
    for (const { name, results, attempt, intervalMs = HOUR, expected } of CASES) {
        test(`${name}: ${expected ?? 'no retry'}`, () => {
            assert.equal(retryDelayMs(results, DEFAULT_URLS, attempt, intervalMs), expected);
        });
    }
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

    test('refreshes its default provider, and records why it does not use one that sync brought in', async () => {
        installed = mockFetch({ [defaultUrl]: jsonResponse(manifestDoc([])) });

        const results = await refreshProviders();

        assert.deepEqual(installed.calls, [defaultUrl]);
        assert.equal(results[0].error, undefined);
        assert.match(results[1].error, /no permission to use this provider/);
        const data = await getProviderData(synced);
        assert.match(data.errors[0].message, /no permission to use this provider/);
    });
});
