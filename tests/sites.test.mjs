import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const {
    patchManifest, diffSites, renderModule, fetchSites, readReleasedManifest,
    parseRawGithubUrl, pinnedManifestUrl, resolveCommit, isOnBranch, keepCandidate,
} = await import('../tools/sites.mjs');
const { SITE_CONFIGS } = await import('../src/generated/sites.js');
const { ARBITRARY_ORIGINS } = await import('../src/options/origins.js');

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

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
    const patched = patchManifest(manifest, { 'on.example': site('on.example', true), 'off.example': site('off.example', false) }, released);

    test('puts enabled sites in host_permissions and disabled sites in optional_host_permissions', () => {
        assert.deepEqual(patched.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://on.example/*']);
        assert.deepEqual(patched.optional_host_permissions, [ARBITRARY_ORIGINS, 'https://off.example/*']);
    });

    test('keeps an enabled site optional when the previous release had it optional', () => {
        const turnedOn = patchManifest(manifest, { 'was-off.example': site('was-off.example', true) }, released);
        assert.deepEqual(turnedOn.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*']);
        assert.deepEqual(turnedOn.optional_host_permissions, [ARBITRARY_ORIGINS, 'https://was-off.example/*']);
    });

    test('puts every site in the named web_accessible_resources group and leaves the wildcard group alone', () => {
        assert.deepEqual(patched.web_accessible_resources[0].matches, ['https://on.example/*', 'https://off.example/*']);
        assert.deepEqual(patched.web_accessible_resources[1], manifest.web_accessible_resources[1]);
    });

    test('does not change its argument', () => {
        assert.deepEqual(manifest.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://old.example/*']);
    });
});

describe('the committed sites', () => {
    test('manifest.json agrees with src/generated/sites.js (make check-sites)', () => {
        assert.deepEqual(patchManifest(base, SITE_CONFIGS, base), base);
    });

    const released = readReleasedManifest();
    const noRelease = !released && 'no git history or v* tag';
    test('manifest.json keeps optional the origins that the previous release has optional', { skip: noRelease }, () => {
        assert.deepEqual(patchManifest(base, SITE_CONFIGS, released), base);
    });

    test('the module renders back to itself', async () => {
        const { SITES_SOURCE, SITES_COMMIT } = await import('../src/generated/sites.js');
        const committed = readFileSync(new URL('../src/generated/sites.js', import.meta.url), 'utf8');
        assert.equal(renderModule(SITES_SOURCE, SITE_CONFIGS, SITES_COMMIT), committed);
    });
});

describe('diffSites', () => {
    test('names each added, removed and changed site, and nothing else', () => {
        const bundled = { 'same.example': site('same.example', true), 'gone.example': site('gone.example', true), 'edit.example': site('edit.example', true) };
        const published = { 'same.example': site('same.example', true), 'new.example': site('new.example', true), 'edit.example': site('edit.example', false) };

        assert.deepEqual(diffSites(bundled, published).sort(), [
            '+ new.example: published, not bundled',
            '- gone.example: bundled, not published',
            '~ edit.example: changed',
        ]);
        assert.deepEqual(diffSites(bundled, structuredClone(bundled)), []);
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

describe('keepCandidate', () => {
    const sites = { 'www.example.fi': site('www.example.fi', true) };
    const committed = { SITES_SOURCE: SOURCE, SITES_COMMIT: SHA, SITE_CONFIGS: sites };

    test('keeps the committed commit while the sites are the same', () => {
        assert.equal(keepCandidate(committed, SOURCE, structuredClone(sites)), SHA);
    });

    const replaced = [
        ['no committed module', null, sites],
        ['changed sites', committed, { 'www.example.fi': site('www.example.fi', false) }],
        ['another source', { ...committed, SITES_SOURCE: 'http://127.0.0.1:8000/manifest.json' }, sites],
        ['no committed commit', { ...committed, SITES_COMMIT: null }, sites],
        ['a module without a commit', { SITES_SOURCE: SOURCE, SITE_CONFIGS: sites }, sites],
    ];
    for (const [name, module, fetched] of replaced) {
        test(`gives null for ${name}`, () => assert.equal(keepCandidate(module, SOURCE, fetched), null));
    }
});
