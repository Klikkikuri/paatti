import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const { patchManifest, diffSites, renderModule, fetchSites } = await import('../tools/sites.mjs');
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
    const patched = patchManifest(manifest, { 'on.example': site('on.example', true), 'off.example': site('off.example', false) });

    test('puts enabled sites in host_permissions and disabled sites in optional_host_permissions', () => {
        assert.deepEqual(patched.host_permissions, ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://on.example/*']);
        assert.deepEqual(patched.optional_host_permissions, [ARBITRARY_ORIGINS, 'https://off.example/*']);
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
        assert.deepEqual(patchManifest(base, SITE_CONFIGS), base);
    });

    test('the module renders back to itself', async () => {
        const { SITES_SOURCE } = await import('../src/generated/sites.js');
        const committed = readFileSync(new URL('../src/generated/sites.js', import.meta.url), 'utf8');
        assert.equal(renderModule(SITES_SOURCE, SITE_CONFIGS), committed);
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
    async function serve(manifest) {
        const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(manifest)));
        await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
        return { url: `http://127.0.0.1:${server.address().port}/manifest.json`, close: () => server.close() };
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
});
