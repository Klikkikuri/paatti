import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const {
    patchManifest, originsOf, diffOrigins, renderJson, fetchSites, readReleasedManifest, readLock,
    parseRawGithubUrl, pinnedManifestUrl, resolveCommit, isOnBranch, keepCandidate, requirePinned, requireSource,
} = await import('../tools/sites.mjs');
const { ARBITRARY_ORIGINS } = await import('../src/options/origins.js');

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const lock = readLock();

const site = (key, enabled) => ({ name: key, enabled, origins: [`https://${key}/*`], rules: [], links: [] });

describe('patchManifest', () => {
    const manifest = {
        host_permissions: ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://old.example/*'],
        optional_host_permissions: [ARBITRARY_ORIGINS, 'https://gone.example/*'],
        web_accessible_resources: [
            { resources: ['a.js'], matches: ['https://old.example/*'] },
            { resources: ['a.js'], matches: [ARBITRARY_ORIGINS] },
        ],
    };
    const released = { optional_host_permissions: [ARBITRARY_ORIGINS, 'https://was-off.example/*'] };
    const patched = patchManifest(manifest, { enabled: ['https://on.example/*'], disabled: ['https://off.example/*'] }, released);

    test('puts enabled sites in host_permissions and disabled sites in optional_host_permissions', () => {
        assert.deepEqual(patched.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://on.example/*']);
        assert.deepEqual(patched.optional_host_permissions, [ARBITRARY_ORIGINS, 'https://off.example/*']);
    });

    test('keeps an enabled site optional when the previous release had it optional', () => {
        const turnedOn = patchManifest(manifest, { enabled: ['https://was-off.example/*'], disabled: [] }, released);
        assert.deepEqual(turnedOn.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*']);
        assert.deepEqual(turnedOn.optional_host_permissions, [ARBITRARY_ORIGINS, 'https://was-off.example/*']);
    });

    test('puts every site in the named web_accessible_resources group, sorted, and leaves the wildcard group alone', () => {
        assert.deepEqual(patched.web_accessible_resources[0].matches, ['https://off.example/*', 'https://on.example/*']);
        assert.deepEqual(patched.web_accessible_resources[1], manifest.web_accessible_resources[1]);
    });

    test('keeps the other entries first, in their order, and sorts the site origins after them', () => {
        const origins = { enabled: ['https://b.example/*', 'https://a.example/*', 'https://a.example/*'], disabled: ['https://d.example/*', 'https://c.example/*'] };
        const result = patchManifest(manifest, origins, released);
        assert.deepEqual(result.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://a.example/*', 'https://b.example/*']);
        assert.deepEqual(result.optional_host_permissions, [ARBITRARY_ORIGINS, 'https://c.example/*', 'https://d.example/*']);
    });

    test('does not change its argument', () => {
        assert.deepEqual(manifest.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://old.example/*']);
    });
});

describe('the committed lock and manifest', () => {
    test('sites.lock.json is pinned and well formed', () => {
        assert.doesNotThrow(() => requirePinned(lock, lock?.source));
    });

    test('sites.lock.json is written as the sync writes it', () => {
        assert.equal(readFileSync(new URL('../sites.lock.json', import.meta.url), 'utf8'), renderJson(lock));
    });

    // Content scripts and dynamic imports fail on a site without these entries.
    test('manifest.json declares each origin of the lock, and exposes the modules to it', () => {
        const hosts = new Set(base.host_permissions);
        const optional = new Set(base.optional_host_permissions);
        const named = base.web_accessible_resources.find((group) => !group.matches.includes(ARBITRARY_ORIGINS));
        for (const origin of lock.origins.enabled) assert.ok(hosts.has(origin) || optional.has(origin), origin);
        for (const origin of lock.origins.disabled) assert.ok(optional.has(origin), origin);
        for (const origin of [...lock.origins.enabled, ...lock.origins.disabled]) assert.ok(named.matches.includes(origin), origin);
    });

    const released = readReleasedManifest();
    const noRelease = !released && 'no git history or v* tag';
    test('manifest.json keeps optional the origins that the previous release has optional', { skip: noRelease }, () => {
        assert.deepEqual(patchManifest(base, lock.origins, released), base);
    });
});

describe('originsOf', () => {
    test('sorts the origins of the enabled and the disabled sites, without duplicates', () => {
        const sites = {
            'b.example': site('b.example', true),
            'a.example': { ...site('a.example', true), origins: ['https://a.example/*', 'https://*.a.example/*'] },
            'off.example': site('off.example', false),
        };
        assert.deepEqual(originsOf(sites), {
            enabled: ['https://*.a.example/*', 'https://a.example/*', 'https://b.example/*'],
            disabled: ['https://off.example/*'],
        });
    });

    test('keeps an origin that an enabled site has out of disabled', () => {
        const sites = { on: { ...site('on', true), origins: ['https://x.example/*'] }, off: { ...site('off', false), origins: ['https://x.example/*'] } };
        assert.deepEqual(originsOf(sites), { enabled: ['https://x.example/*'], disabled: [] });
    });
});

describe('diffOrigins', () => {
    test('names each added and removed origin, and nothing else', () => {
        const expected = { enabled: ['https://same.example/*', 'https://gone.example/*'], disabled: [] };
        const actual = { enabled: ['https://same.example/*'], disabled: ['https://gone.example/*'] };
        assert.deepEqual(diffOrigins(expected, actual), ['- enabled https://gone.example/*', '+ disabled https://gone.example/*']);
        assert.deepEqual(diffOrigins(expected, structuredClone(expected)), []);
    });
});

describe('fetchSites', () => {
    /** Serves `documents` by path, and `manifest` for every other path. */
    async function serve(manifest, documents = {}) {
        const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify(documents[req.url] ?? manifest)));
        await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
        return { url: `http://127.0.0.1:${server.address().port}/rahti/manifest.json`, close: () => server.close() };
    }
    const manifest = (sites) => ({ schema_version: '0.1.0', name: 'Test', resources: [{ type: 'site-configs', sites }] });

    test('returns the resolved sites, with their default origins', async () => {
        const { url, close } = await serve(manifest({ 'www.example.fi': { name: 'Example', rules: [] } }));
        try {
            const sites = await fetchSites(url);
            assert.deepEqual(sites['www.example.fi'].origins, ['https://www.example.fi/*']);
            assert.equal(sites['www.example.fi'].enabled, true);
        } finally {
            close();
        }
    });

    test('fails when the resolver refuses a site, rather than writing the rest', async () => {
        const { url, close } = await serve(manifest({ 'www.example.fi': { name: 'Example', origins: ['https://www.hs.fi/*'] } }));
        try {
            await assert.rejects(fetchSites(url), /site configurations refused/);
        } finally {
            close();
        }
    });

    test('refuses a site-configs href outside the manifest directory, or one that does not parse', async () => {
        const sites = { schema_version: '0.1.0', sites: { 'www.example.fi': { name: 'Example', rules: [] } } };
        const linked = (href) => ({ schema_version: '0.1.0', name: 'Test', resources: [{ type: 'site-configs', href }] });
        const { url, close } = await serve(linked('../main/sites.json'), {
            '/rahti/sites.json': sites, '/main/sites.json': sites, '/rahti/bad.json': linked('http://[bad'),
        });
        try {
            await assert.rejects(fetchSites(url), /site-configs outside .*\/rahti\/: \.\.\/main\/sites\.json/);
            await assert.rejects(fetchSites(`${url.replace('/manifest.json', '/bad.json')}`), /site-configs outside .*: http:\/\/\[bad/);
        } finally {
            close();
        }
    });
});

const SOURCE = 'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/manifest.json';
const SHA = 'dda566c30445e8e39ca938fad92c0db7255c46c0';
const OTHER_SHA = '67f9c5730b451cfe638cad2c2d55dea1de1ad26d';

describe('parseRawGithubUrl', () => {
    test('splits a raw GitHub URL on a branch, and gives null for another host', () => {
        assert.deepEqual(parseRawGithubUrl(SOURCE), { owner: 'Klikkikuri', repo: 'rahti', branch: 'main', path: 'manifest.json' });
        assert.equal(parseRawGithubUrl('http://127.0.0.1:8000/manifest.json'), null);
    });

    const refused = [
        ['the short branch form', 'https://raw.githubusercontent.com/Klikkikuri/rahti/main/manifest.json'],
        ['http', SOURCE.replace('https:', 'http:')],
        ['a port', SOURCE.replace('.com/', '.com:8443/')],
        ['credentials', SOURCE.replace('https://', 'https://user@')],
        ['a query', `${SOURCE}?x=1`],
        ['a fragment', `${SOURCE}#x`],
    ];
    for (const [name, url] of refused) {
        test(`refuses ${name}`, () => assert.throws(() => parseRawGithubUrl(url), /not https:\/\/raw/));
    }
});

describe('pinnedManifestUrl', () => {
    test('puts the commit in place of the branch', () => {
        assert.equal(pinnedManifestUrl(SOURCE, SHA), `https://raw.githubusercontent.com/Klikkikuri/rahti/${SHA}/manifest.json`);
    });
});

describe('resolveCommit', () => {
    test('gives the commit of the branch, from the repository of the URL', () => {
        const calls = [];
        const lsRemote = (...args) => { calls.push(args); return `${SHA}\trefs/heads/main\n`; };
        assert.equal(resolveCommit(SOURCE, lsRemote), SHA);
        assert.deepEqual(calls, [['https://github.com/Klikkikuri/rahti', 'refs/heads/main']]);
    });

    test('gives null for another host, without git', () => {
        assert.equal(resolveCommit('http://127.0.0.1:8000/manifest.json', () => assert.fail('git ran')), null);
    });

    const failures = [
        ['no line', ''],
        ['two lines', `${SHA}\trefs/heads/main\n${OTHER_SHA}\trefs/heads/x/refs/heads/main`],
        ['another ref', `${SHA}\trefs/heads/x/refs/heads/main`],
        ['a commit that is not 40 hex digits', 'dda566c\trefs/heads/main'],
    ];
    for (const [name, output] of failures) {
        test(`throws on ${name}`, () => assert.throws(() => resolveCommit(SOURCE, () => output), /cannot resolve refs\/heads\/main/));
    }

    test('throws when git fails', () => {
        assert.throws(() => resolveCommit(SOURCE, () => { throw new Error('git: no network'); }), /no network/);
    });
});

describe('isOnBranch', () => {
    const reply = (status, body = {}) => async () => new Response(JSON.stringify(body), { status });

    test('asks GitHub to compare the commit with the branch', async () => {
        let asked;
        await isOnBranch(SOURCE, SHA, async (url) => { asked = url; return reply(200, { status: 'ahead' })(); });
        assert.equal(asked, `https://api.github.com/repos/Klikkikuri/rahti/compare/${SHA}...main`);
    });

    const statuses = [['ahead', true], ['identical', true], ['behind', false], ['diverged', false]];
    for (const [status, expected] of statuses) {
        test(`is ${expected} when the branch is ${status}`, async () => {
            assert.equal(await isOnBranch(SOURCE, SHA, reply(200, { status })), expected);
        });
    }

    test('is false for a commit that GitHub does not know', async () => {
        assert.equal(await isOnBranch(SOURCE, SHA, reply(404)), false);
    });

    test('throws on another HTTP error', async () => {
        await assert.rejects(isOnBranch(SOURCE, SHA, reply(503)), /HTTP 503/);
    });
});

const ORIGINS = { enabled: ['https://www.example.fi/*'], disabled: ['https://off.example.fi/*'] };
const LOCK = { source: SOURCE, commit: SHA, origins: ORIGINS };

describe('keepCandidate', () => {
    test('keeps the commit of the lock while the origins are the same', () => {
        assert.equal(keepCandidate(LOCK, SOURCE, structuredClone(ORIGINS)), SHA);
    });

    const replaced = [
        ['no lock', null, ORIGINS],
        ['changed origins', LOCK, { enabled: ORIGINS.disabled, disabled: ORIGINS.enabled }],
        ['another source', { ...LOCK, source: 'http://127.0.0.1:8000/manifest.json' }, ORIGINS],
        ['no commit', { ...LOCK, commit: null }, ORIGINS],
    ];
    for (const [name, committed, origins] of replaced) {
        test(`gives null for ${name}`, () => assert.equal(keepCandidate(committed, SOURCE, origins), null));
    }
});

describe('requirePinned', () => {
    test('accepts a pinned, well-formed lock', () => {
        assert.doesNotThrow(() => requirePinned(LOCK, SOURCE));
    });

    const refused = [
        ['no lock', null, /missing or not JSON/],
        ['another source', { ...LOCK, source: 'http://127.0.0.1:8000/manifest.json' }, /comes from/],
        ['no commit', { ...LOCK, commit: null }, /records no Rahti commit/],
        ['unsorted origins', { ...LOCK, origins: { enabled: ['https://b.example/*', 'https://a.example/*'], disabled: [] } }, /must be sorted/],
        ['duplicates', { ...LOCK, origins: { enabled: ['https://a.example/*', 'https://a.example/*'], disabled: [] } }, /must be sorted/],
        ['an origin in both lists', { ...LOCK, origins: { enabled: ['https://a.example/*'], disabled: ['https://a.example/*'] } }, /disjoint/],
        ['an entry that is not a site origin', { ...LOCK, origins: { enabled: [ARBITRARY_ORIGINS], disabled: [] } }, /site origins/],
        ['no enabled origin', { ...LOCK, origins: { enabled: [], disabled: [] } }, /must not be empty/],
        ['no origins', { source: SOURCE, commit: SHA }, /must be sorted/],
    ];
    for (const [name, value, message] of refused) {
        test(`refuses ${name}`, () => assert.throws(() => requirePinned(value, SOURCE), message));
    }

    test('requireSource checks only the source', () => {
        assert.doesNotThrow(() => requireSource({ ...LOCK, commit: null }, SOURCE));
        assert.throws(() => requireSource({ ...LOCK, source: 'http://127.0.0.1:8000/manifest.json' }, SOURCE), /comes from/);
    });
});
