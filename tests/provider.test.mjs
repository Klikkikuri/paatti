import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    caretCompatible, providerBlockReason, parseManifest, originsMatchKey, computeDeclaredScope,
    inspect, resolve, MAX_RESOURCES
} from '../src/provider.js';

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

const jsonResponse = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers });
const notFound = () => new Response('', { status: 404 });

const manifestDoc = (resources, overrides = {}) => ({
    schema_version: '0.1.0',
    name: 'Test provider',
    updated: '2026-09-14T00:00:00Z',
    resources,
    ...overrides
});

const siteDoc = (sites) => ({ schema_version: '0.1.0', sites });
const site = (key, extra = {}) => ({ name: key, enabled: true, origins: [`https://${key}/*`], rules: [], ...extra });

const rahtiDoc = (entries) => ({ schema_version: '0.1.0', updated: '2026-09-14T00:00:00Z', entries });

let installed;
afterEach(() => { if (installed) { installed.restore(); installed = null; } });

describe('caretCompatible', () => {
    test('accepts the same major and minor while the major is 0', () => {
        assert.equal(caretCompatible('0.1.7'), true);
    });
    test('refuses a minor bump while the major is 0', () => {
        assert.equal(caretCompatible('0.2.0'), false);
    });
    test('refuses a major bump', () => {
        assert.equal(caretCompatible('1.0.0'), false);
    });
    test('refuses an unparsable version', () => {
        assert.equal(caretCompatible(undefined), false);
    });
});

describe('providerBlockReason', () => {
    test('requires HTTPS for a remote host, unlike blockReason', () => {
        assert.match(providerBlockReason('http://example.test/manifest.json', false), /https/);
    });
    test('allows a loopback address at either scheme once enabled', () => {
        assert.equal(providerBlockReason('http://localhost:3000/manifest.json', true), null);
        assert.equal(providerBlockReason('https://127.0.0.1:3000/manifest.json', true), null);
    });
    test('refuses loopback when the setting is off', () => {
        assert.match(providerBlockReason('http://localhost:3000/manifest.json', false), /.+/);
    });
    test('a private address is refused at either setting', () => {
        assert.match(providerBlockReason('https://192.168.1.1/manifest.json', true), /reserved/);
    });
});

describe('parseManifest', () => {
    test('rejects a manifest whose schema_version fails the caret rule', () => {
        const { error } = parseManifest(manifestDoc([], { schema_version: '0.2.0' }));
        assert.match(error, /schema_version/);
    });

    test('rejects a negative weight', () => {
        const { error } = parseManifest(manifestDoc([{ type: 'suola-rules', href: './rules.json', weight: -1 }]));
        assert.match(error, /malformed/);
    });

    test('rejects more resources than the limit', () => {
        const resources = Array.from({ length: MAX_RESOURCES + 1 }, (_, i) => ({ type: 'x-anything', href: `./r${i}.json` }));
        const { error } = parseManifest(manifestDoc(resources));
        assert.match(error, /too many resources/);
    });

    test('parses an unknown type as ignored rather than failing', () => {
        const { manifest, error } = parseManifest(manifestDoc([{ type: 'x-future-thing', href: './whatever.json' }]));
        assert.equal(error, undefined);
        assert.equal(manifest.resources[0].known, false);
    });
});

describe('inspect', () => {
    test('issues zero fetches when the manifest URL itself is blocked', async () => {
        installed = mockFetch({});
        const result = await inspect('http://localhost:8080/api/shutdown', { loopbackProvidersEnabled: false });
        assert.match(result.error, /.+/);
        assert.deepEqual(installed.calls, []);
    });

    test('fetches only the manifest for cross-origin resources, and reports their origins', async () => {
        const manifestUrl = 'https://provider.example/manifest.json';
        installed = mockFetch({
            [manifestUrl]: jsonResponse(manifestDoc([
                { type: 'rahti-data', href: 'http://localhost:8080/data.json' },
                { type: 'suola-rules', href: 'http://192.168.1.1/rules.json' }
            ]))
        });

        const result = await inspect(manifestUrl, { loopbackProvidersEnabled: false });

        assert.deepEqual(installed.calls, [manifestUrl]);
        assert.ok(result.origins.has('http://localhost:8080'));
        assert.ok(result.origins.has('http://192.168.1.1'));
    });

    test('reads a same-origin site-configs document but not a cross-origin one', async () => {
        const manifestUrl = 'https://provider.example/manifest.json';
        const sitesUrl = 'https://provider.example/sites.json';
        installed = mockFetch({
            [manifestUrl]: jsonResponse(manifestDoc([
                { type: 'site-configs', href: './sites.json' },
                { type: 'rahti-data', href: 'https://data.example/data.json' }
            ])),
            [sitesUrl]: jsonResponse(siteDoc({ 'news.example': site('news.example') }))
        });

        const result = await inspect(manifestUrl, {});

        assert.deepEqual(installed.calls, [manifestUrl, sitesUrl]);
        assert.ok(result.sites['news.example']);
        assert.ok(result.origins.has('https://data.example'), 'rahti-data origin still disclosed though not fetched');
    });

    test('never discloses a same-origin site that resolve() would go on to reject', async () => {
        const manifestUrl = 'https://provider.example/manifest.json';
        installed = mockFetch({
            [manifestUrl]: jsonResponse(manifestDoc([{
                type: 'site-configs',
                sites: { 'news.example': site('news.example') },
                origins: ['https://news.example/*'] // same-origin resources must not declare this
            }]))
        });

        const inspected = await inspect(manifestUrl, {});
        assert.deepEqual(inspected.sites, {});

        const { manifest } = parseManifest(manifestDoc([{
            type: 'site-configs', sites: { 'news.example': site('news.example') }, origins: ['https://news.example/*']
        }]));
        const resolved = await resolve(manifest, manifestUrl);
        assert.deepEqual(resolved.siteConfigs, {});
    });

    test('reflects a shadowing rejection too, when the caller passes the same claimed keys resolve() would', async () => {
        const manifestUrl = 'https://provider.example/manifest.json';
        installed = mockFetch({
            [manifestUrl]: jsonResponse(manifestDoc([{ type: 'site-configs', sites: { 'yle.fi': site('yle.fi') } }]))
        });

        const result = await inspect(manifestUrl, { claimedSiteKeys: new Set(['yle.fi']), providerShadowingEnabled: false });

        assert.deepEqual(result.sites, {});
        assert.ok(result.rejected.some((r) => r.key === 'yle.fi'));
    });

    test('an all-relative manifest declares no cross-origin resource and resolves inline site-configs', async () => {
        const manifestUrl = 'https://provider.example/manifest.json';
        installed = mockFetch({
            [manifestUrl]: jsonResponse(manifestDoc([
                { type: 'site-configs', sites: { 'news.example': site('news.example') } }
            ]))
        });

        const result = await inspect(manifestUrl, {});

        assert.deepEqual(installed.calls, [manifestUrl]);
        assert.ok(result.sites['news.example']);
        assert.equal(result.origins.size, 0);
    });
});

describe('resolve: fetch discipline and isolation', () => {
    async function parsedManifest(resources) {
        const { manifest } = parseManifest(manifestDoc(resources));
        return manifest;
    }

    test('an x-typed resource issues no fetch and contributes nothing', async () => {
        installed = mockFetch({});
        const manifest = await parsedManifest([{ type: 'x-anything', href: 'https://provider.example/whatever.json' }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(installed.calls, []);
        assert.deepEqual(result.errors, []);
    });

    test('a response that would redirect fails rather than being followed', async () => {
        const href = 'https://provider.example/rules.json';
        installed = mockFetch({ [href]: new TypeError('fetch failed: redirect') });
        const manifest = await parsedManifest([{ type: 'suola-rules', href }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(result.suolaRules, null);
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0].message, /redirect/);
    });

    test('two hrefs on one resource are both fetched and merged in list order', async () => {
        const a = 'https://provider.example/rules-a.json';
        const b = 'https://provider.example/rules-b.json';
        installed = mockFetch({
            [a]: jsonResponse({ sites: [{ domain: 'a.example' }] }),
            [b]: jsonResponse({ sites: [{ domain: 'b.example' }] })
        });
        const manifest = await parsedManifest([{ type: 'suola-rules', href: [a, b] }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.suolaRules.sites.map((s) => s.domain), ['a.example', 'b.example']);
    });

    test('when one href of a resource 404s, the other still merges and the failure is reported', async () => {
        const good = 'https://provider.example/rules-good.json';
        const bad = 'https://provider.example/rules-bad.json';
        installed = mockFetch({ [good]: jsonResponse({ sites: [{ domain: 'a.example' }] }), [bad]: notFound() });
        const manifest = await parsedManifest([{ type: 'suola-rules', href: [good, bad] }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.suolaRules.sites, [{ domain: 'a.example' }]);
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].href, bad);
    });

    test('href and inline combine fetched first, inline last', async () => {
        const href = 'https://provider.example/rules.json';
        installed = mockFetch({ [href]: jsonResponse({ sites: [{ domain: 'fetched.example' }] }) });
        const manifest = await parsedManifest([
            { type: 'suola-rules', href, rules: { sites: [{ domain: 'inline.example' }] } }
        ]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.suolaRules.sites.map((s) => s.domain), ['fetched.example', 'inline.example']);
    });

    test('a resource beyond the fetch budget is refused rather than fetched', async () => {
        // 32 resources (the resource-count limit): one carries two hrefs, the rest one each, for 33
        // distinct hrefs between them -- one over MAX_FETCHES, so this exercises that limit and not
        // MAX_RESOURCES.
        const urls = Array.from({ length: 33 }, (_, i) => `https://provider.example/r${i}.json`);
        const map = {};
        for (const url of urls) map[url] = jsonResponse({ sites: [] });
        installed = mockFetch(map);

        const resources = [{ type: 'suola-rules', href: [urls[0], urls[1]] }];
        for (const href of urls.slice(2)) resources.push({ type: 'suola-rules', href });
        const manifest = await parsedManifest(resources);

        assert.equal(resources.length, 32);
        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(installed.calls.length, 32);
        assert.ok(result.errors.some((e) => /budget/.test(e.message)));
    });

    test('a duplicated href is fetched once', async () => {
        const href = 'https://provider.example/rules.json';
        installed = mockFetch({ [href]: jsonResponse({ sites: [{ domain: 'a.example' }] }) });
        const manifest = await parsedManifest([
            { type: 'suola-rules', href },
            { type: 'suola-rules', href }
        ]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(installed.calls.length, 1);
        assert.deepEqual(result.suolaRules.sites, [{ domain: 'a.example' }, { domain: 'a.example' }]);
    });

    test('a malformed href is reported against its resource rather than crashing resolve', async () => {
        const good = 'https://provider.example/good.json';
        installed = mockFetch({ [good]: jsonResponse({ sites: [{ domain: 'a.example' }] }) });
        const manifest = await parsedManifest([{ type: 'suola-rules', href: ['http://[::1', good] }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.suolaRules.sites, [{ domain: 'a.example' }]);
        assert.ok(result.errors.some((e) => /malformed href/.test(e.message)));
    });

    test('a malformed href does not crash inspect either', async () => {
        const manifestUrl = 'https://provider.example/manifest.json';
        installed = mockFetch({
            [manifestUrl]: jsonResponse(manifestDoc([{ type: 'suola-rules', href: 'http://[::1' }]))
        });

        const result = await inspect(manifestUrl, {});

        assert.equal(result.error, undefined);
    });

    test('resources are fetched in (weight, document order)', async () => {
        const low = 'https://provider.example/low.json';
        const high = 'https://provider.example/high.json';
        installed = mockFetch({
            [low]: jsonResponse({ sites: [{ domain: 'low' }] }),
            [high]: jsonResponse({ sites: [{ domain: 'high' }] })
        });
        const manifest = await parsedManifest([
            { type: 'suola-rules', href: high, weight: 5 },
            { type: 'suola-rules', href: low, weight: 1 }
        ]);

        await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(installed.calls, [low, high]);
    });
});

describe('resolve: rahti-data', () => {
    async function parsedManifest(resources) {
        const { manifest } = parseManifest(manifestDoc(resources));
        return manifest;
    }

    test('keys entries by sign, last resource wins per signature', async () => {
        const a = 'https://provider.example/data-a.json';
        const b = 'https://provider.example/data-b.json';
        installed = mockFetch({
            [a]: jsonResponse(rahtiDoc([{ urls: [{ sign: 's1' }], title: 'first' }])),
            [b]: jsonResponse(rahtiDoc([{ urls: [{ sign: 's1' }], title: 'second' }]))
        });
        const manifest = await parsedManifest([
            { type: 'rahti-data', href: a },
            { type: 'rahti-data', href: b }
        ]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(result.rahtiData.s1.title, 'second');
    });

    test('a major-version mismatch is isolated to its own resource', async () => {
        const good = 'https://provider.example/data-good.json';
        const bad = 'https://provider.example/data-bad.json';
        installed = mockFetch({
            [good]: jsonResponse(rahtiDoc([{ urls: [{ sign: 's1' }], title: 'ok' }])),
            [bad]: jsonResponse({ schema_version: '9.0.0', entries: [] })
        });
        const manifest = await parsedManifest([
            { type: 'rahti-data', href: good },
            { type: 'rahti-data', href: bad }
        ]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(result.rahtiData.s1.title, 'ok');
        assert.equal(result.errors.length, 1);
    });
});

describe('resolve: conditional GET / 304 handling (rahti-data only)', () => {
    async function parsedManifest(resources) {
        const { manifest } = parseManifest(manifestDoc(resources));
        return manifest;
    }

    test('a fresh 200 response reports its etag/lastModified in resourceHeaders', async () => {
        const url = 'https://provider.example/data.json';
        installed = mockFetch({
            [url]: jsonResponse(rahtiDoc([{ urls: [{ sign: 's1' }], title: 'first' }]),
                { ETag: '"v1"', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT' })
        });
        const manifest = await parsedManifest([{ type: 'rahti-data', href: url }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(result.rahtiData.s1.title, 'first');
        assert.deepEqual(result.resourceHeaders[url], { etag: '"v1"', lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' });
    });

    test('an all-304 refresh reuses previousRahtiData verbatim, without merging any content', async () => {
        const url = 'https://provider.example/data.json';
        installed = mockFetch({ [url]: new Response(null, { status: 304 }) });
        const manifest = await parsedManifest([{ type: 'rahti-data', href: url }]);
        const previousRahtiData = { s1: { title: 'cached' } };

        const result = await resolve(manifest, 'https://provider.example/manifest.json', {
            resourceHeaders: { [url]: { etag: '"v1"' } },
            previousRahtiData,
            previousDatabaseGenerationDate: '2024-01-01T00:00:00Z'
        });

        assert.deepEqual(result.rahtiData, previousRahtiData);
        assert.equal(result.databaseGenerationDate, '2024-01-01T00:00:00Z');
        assert.deepEqual(result.resourceHeaders[url], { etag: '"v1"' });
    });

    test('{force: true} bypasses cached headers and sends no conditional request headers', async () => {
        const url = 'https://provider.example/data.json';
        const requestInits = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (u, init) => {
            requestInits.push(init);
            return jsonResponse(rahtiDoc([{ urls: [{ sign: 's1' }], title: 'forced' }]));
        };
        try {
            const manifest = await parsedManifest([{ type: 'rahti-data', href: url }]);
            const result = await resolve(manifest, 'https://provider.example/manifest.json', {
                resourceHeaders: { [url]: { etag: '"v1"' } },
                force: true
            });
            assert.equal(result.rahtiData.s1.title, 'forced');
            assert.equal(requestInits[0]?.headers, undefined, 'no conditional headers were sent when forced');
        } finally {
            globalThis.fetch = original;
        }
    });

    test('a mixed batch (one 304, one 200) re-fetches the 304\'d href fully rather than dropping it', async () => {
        const a = 'https://provider.example/data-a.json';
        const b = 'https://provider.example/data-b.json';
        let aCallCount = 0;
        const original = globalThis.fetch;
        globalThis.fetch = async (u) => {
            const key = String(u);
            if (key === a) {
                aCallCount++;
                // First (conditional) call: 304. Second (forced re-fetch) call: real content.
                return aCallCount === 1
                    ? new Response(null, { status: 304 })
                    : jsonResponse(rahtiDoc([{ urls: [{ sign: 'sa' }], title: 'from-a' }]));
            }
            if (key === b) return jsonResponse(rahtiDoc([{ urls: [{ sign: 'sb' }], title: 'from-b' }]));
            throw new Error(`unexpected fetch: ${key}`);
        };
        try {
            const manifest = await parsedManifest([
                { type: 'rahti-data', href: a },
                { type: 'rahti-data', href: b }
            ]);
            const result = await resolve(manifest, 'https://provider.example/manifest.json', {
                resourceHeaders: { [a]: { etag: '"v1"' } },
                previousRahtiData: { sa: { title: 'stale' } }
            });

            assert.equal(aCallCount, 2, 'the 304\'d href was re-fetched in full since the batch was mixed');
            assert.equal(result.rahtiData.sa.title, 'from-a', 'the re-fetched content replaced the stale cached value');
            assert.equal(result.rahtiData.sb.title, 'from-b');
        } finally {
            globalThis.fetch = original;
        }
    });

    test('a site-configs resource is always fetched in full, never receives a cacheEntry', async () => {
        const rahtiUrl = 'https://provider.example/data.json';
        const siteUrl = 'https://provider.example/sites.json';
        const requestInits = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (u, init) => {
            const key = String(u);
            requestInits.push({ key, headers: init?.headers });
            if (key === rahtiUrl) return new Response(null, { status: 304 });
            if (key === siteUrl) return jsonResponse(siteDoc({ 'news.example': site('news.example') }));
            throw new Error(`unexpected fetch: ${key}`);
        };
        try {
            const manifest = await parsedManifest([
                { type: 'rahti-data', href: rahtiUrl },
                { type: 'site-configs', href: siteUrl }
            ]);
            const result = await resolve(manifest, 'https://provider.example/manifest.json', {
                resourceHeaders: { [rahtiUrl]: { etag: '"v1"' } },
                previousRahtiData: {}
            });

            const siteRequest = requestInits.find((r) => r.key === siteUrl);
            assert.ok(siteRequest, 'the site-configs href was actually fetched');
            assert.equal(siteRequest.headers, undefined, 'no conditional headers were ever sent for site-configs');
            assert.ok(result.siteConfigs['news.example']);
        } finally {
            globalThis.fetch = original;
        }
    });

    test('the payload\'s own updated field becomes databaseGenerationDate', async () => {
        const url = 'https://provider.example/data.json';
        installed = mockFetch({
            [url]: jsonResponse({
                schema_version: '0.1.0', updated: '2026-05-01T00:00:00Z',
                entries: [{ urls: [{ sign: 's1' }], title: 'x' }]
            })
        });
        const manifest = await parsedManifest([{ type: 'rahti-data', href: url }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(result.databaseGenerationDate, '2026-05-01T00:00:00Z');
    });
});

describe('resolve: site-configs safety', () => {
    async function parsedManifest(resources) {
        const { manifest } = parseManifest(manifestDoc(resources));
        return manifest;
    }

    test('a site claiming an origin that is not its own key is rejected', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: { 'lapinkansa.fi': site('lapinkansa.fi', { origins: ['https://www.hs.fi/*'] }) }
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.siteConfigs, {});
        assert.ok(result.rejected.some((r) => r.key === 'lapinkansa.fi'));
    });

    test('a site key that is not a bare hostname cannot bypass the shadowing gate via matchesOrigin\'s path-stripping', async () => {
        // matchesOrigin (model.js) reads only the authority up to the first "/" of an origin pattern,
        // so a key like "www.hs.fi/x" would (if accepted) still resolve for lookups against the real
        // "www.hs.fi" -- while claimedSiteKeys, which compares the key string literally, would never
        // have recognised it as already claimed. The key itself must be rejected before that gap opens.
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: { 'www.hs.fi/x': { name: 'evil', enabled: true, rules: [] } }
        }]);

        const result = await resolve(manifest, 'https://attacker.example/manifest.json', {
            claimedSiteKeys: new Set(['www.hs.fi']),
            providerShadowingEnabled: false
        });

        assert.deepEqual(result.siteConfigs, {});
        assert.ok(result.rejected.some((r) => r.key === 'www.hs.fi/x' && /bare hostname/.test(r.reason)));
    });

    test('a site key carrying a port or a scheme is rejected the same way', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: {
                'example.com:8080': { name: 'x', enabled: true, rules: [] },
                'https://example.com': { name: 'x', enabled: true, rules: [] }
            }
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.siteConfigs, {});
        assert.equal(result.rejected.length, 2);
    });

    test('a host wildcard in origins is rejected', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: { 'example.com': site('example.com', { origins: ['https://*.example.com/*'] }) }
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.siteConfigs, {});
    });

    test('a javascript: link is dropped, the site is kept', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: {
                'news.example': site('news.example', {
                    links: [{ rel: 'x-publisher-policy', href: 'javascript:alert(1)' }, { rel: 'license', href: 'https://news.example/license' }]
                })
            }
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.equal(result.siteConfigs['news.example'].links.length, 1);
        assert.equal(result.siteConfigs['news.example'].links[0].href, 'https://news.example/license');
    });

    test('same-origin site-configs must not declare origins', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: { 'news.example': site('news.example') },
            origins: ['https://news.example/*']
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.siteConfigs, {});
        assert.ok(result.rejected.some((r) => /must not declare/.test(r.reason)));
    });

    test('a malformed site-configs href does not crash resolve either', async () => {
        // An unparsable href can't be proven same-origin, so it takes the cross-origin path and is
        // refused there for lacking a declared `origins` -- the point under test is that this reports
        // cleanly rather than throwing out of isSameOrigin().
        const manifest = await parsedManifest([{ type: 'site-configs', href: 'http://[::1' }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.siteConfigs, {});
        assert.ok(result.rejected.some((r) => /cross-origin/.test(r.reason)));
    });

    test('cross-origin site-configs without declared origins is refused', async () => {
        const href = 'https://cdn.example/sites.json';
        installed = mockFetch({ [href]: jsonResponse(siteDoc({ 'news.example': site('news.example') })) });
        const manifest = await parsedManifest([{ type: 'site-configs', href }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(installed.calls, [], 'refused before it could be fetched');
        assert.deepEqual(result.siteConfigs, {});
    });

    test('a cross-origin document adding a site beyond its declared origins is rejected', async () => {
        const href = 'https://cdn.example/sites.json';
        installed = mockFetch({
            [href]: jsonResponse(siteDoc({
                'lapinkansa.fi': site('lapinkansa.fi'),
                'unexpected.example': site('unexpected.example')
            }))
        });
        const manifest = await parsedManifest([{
            type: 'site-configs', href, origins: ['https://www.lapinkansa.fi/*', 'https://lapinkansa.fi/*']
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.ok(result.siteConfigs['lapinkansa.fi']);
        assert.equal(result.siteConfigs['unexpected.example'], undefined);
        assert.ok(result.rejected.some((r) => r.key === 'unexpected.example'));
    });

    test('a shadowing entry replaces the claimed key; without the setting it is rejected', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: { 'yle.fi': site('yle.fi', { rules: [{ container: 'a' }] }) }
        }]);
        const claimedSiteKeys = new Set(['yle.fi']);

        const off = await resolve(manifest, 'https://provider.example/manifest.json', { claimedSiteKeys, providerShadowingEnabled: false });
        assert.equal(off.siteConfigs['yle.fi'], undefined);
        assert.ok(off.rejected.some((r) => r.key === 'yle.fi' && /shadowing is disabled/.test(r.reason)));

        const on = await resolve(manifest, 'https://provider.example/manifest.json', { claimedSiteKeys, providerShadowingEnabled: true });
        assert.deepEqual(on.siteConfigs['yle.fi'].rules, [{ container: 'a' }]);
    });

    test('an unclaimed key is never gated by shadowing', async () => {
        const manifest = await parsedManifest([{ type: 'site-configs', sites: { 'new.example': site('new.example') } }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json', {
            claimedSiteKeys: new Set(['someone-else.example']), providerShadowingEnabled: false
        });

        assert.ok(result.siteConfigs['new.example']);
    });

    test('array fields concatenate and dedupe across two resources of one manifest', async () => {
        const manifest = await parsedManifest([
            { type: 'site-configs', sites: { 'news.example': site('news.example', { rules: [{ container: 'a' }] }) } },
            { type: 'site-configs', sites: { 'news.example': site('news.example', { rules: [{ container: 'a' }, { container: 'b' }] }) } }
        ]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(result.siteConfigs['news.example'].rules, [{ container: 'a' }, { container: 'b' }]);
    });

    test('the declared scope is exactly the merged, valid domain keys', async () => {
        const manifest = await parsedManifest([{
            type: 'site-configs',
            sites: {
                'news.example': site('news.example'),
                'bad.example': site('bad.example', { origins: ['https://other.example/*'] })
            }
        }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json');

        assert.deepEqual(computeDeclaredScope(result.siteConfigs), new Set(['news.example']));
    });
});

describe('resolve: loopback gating', () => {
    async function parsedManifest(resources) {
        const { manifest } = parseManifest(manifestDoc(resources));
        return manifest;
    }

    test('a loopback resource is refused with the setting off, admitted with it on', async () => {
        const href = 'http://localhost:3000/rules.json';
        installed = mockFetch({ [href]: jsonResponse({ sites: [{ domain: 'a' }] }) });
        const manifest = await parsedManifest([{ type: 'suola-rules', href }]);

        const off = await resolve(manifest, 'https://provider.example/manifest.json', { loopbackProvidersEnabled: false });
        assert.equal(off.suolaRules, null);
        assert.deepEqual(installed.calls, []);

        const on = await resolve(manifest, 'https://provider.example/manifest.json', { loopbackProvidersEnabled: true });
        assert.deepEqual(on.suolaRules.sites, [{ domain: 'a' }]);
    });

    test('a private (non-loopback) address stays refused even with the setting on', async () => {
        const href = 'https://192.168.1.1/rules.json';
        installed = mockFetch({});
        const manifest = await parsedManifest([{ type: 'suola-rules', href }]);

        const result = await resolve(manifest, 'https://provider.example/manifest.json', { loopbackProvidersEnabled: true });

        assert.equal(result.suolaRules, null);
        assert.deepEqual(installed.calls, []);
    });
});

describe('originsMatchKey', () => {
    test('accepts the exact host, https or http', () => {
        assert.equal(originsMatchKey('news.example', ['https://news.example/*']), true);
        assert.equal(originsMatchKey('news.example', ['http://news.example/*']), true);
    });
    test('rejects a different host', () => {
        assert.equal(originsMatchKey('news.example', ['https://other.example/*']), false);
    });
    test('rejects a host wildcard', () => {
        assert.equal(originsMatchKey('example.com', ['https://*.example.com/*']), false);
    });
    test('rejects an empty list', () => {
        assert.equal(originsMatchKey('news.example', []), false);
    });
});
