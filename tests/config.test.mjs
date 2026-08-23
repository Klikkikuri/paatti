import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

// Imported dynamically: a static import is hoisted above the assignment above, so
// browser-api.js would resolve the namespace before globalThis.browser exists.
const { getConfig } = await import('../src/config.js');

const { local, sync } = fake.browser.storage;

describe('manifest agrees with the site configs', async () => {
    const { siteConfigs } = await getConfig();

    const hostPermissions = new Set(manifest.host_permissions || []);
    const optionalHostPermissions = new Set(manifest.optional_host_permissions || []);
    const webAccessibleMatches = new Set(
        (manifest.web_accessible_resources || []).flatMap((group) => group.matches || [])
    );

    for (const [domain, siteConfig] of Object.entries(siteConfigs)) {
        const enabledByDefault = siteConfig.enabled !== false;
        const origins = siteConfig.origins || [`https://${domain}/*`];

        for (const origin of origins) {
            test(`${domain}: "${origin}" is in ${enabledByDefault ? '' : 'optional_'}host_permissions`, () => {
                const expected = enabledByDefault ? hostPermissions : optionalHostPermissions;
                assert.ok(expected.has(origin),
                    `Dynamic imports and content scripts will fail for "${domain}" without it.`);
            });

            test(`${domain}: "${origin}" is in web_accessible_resources matches`, () => {
                assert.ok(webAccessibleMatches.has(origin), 'Dynamic imports will 404 on this site.');
            });
        }
    }
});

describe('the config cache', () => {
    test('the first getConfig queries storage once per area', async () => {
        await getConfig();

        assert.equal(fake.reads.local, 1);
        assert.equal(fake.reads.sync, 1);
    });

    test('later calls read from memory and return the same object', async () => {
        const first = await getConfig();
        const second = await getConfig();

        assert.equal(fake.reads.local, 1);
        assert.equal(fake.reads.sync, 1);
        assert.equal(first, second);
    });

    test('a watched key invalidates the cache and forces a re-read', async () => {
        await local.set({ userPreferences: { environment: 'free' } });
        await getConfig();

        assert.equal(fake.reads.local, 2);
        assert.equal(fake.reads.sync, 2);
    });

    test('every key getConfig reads invalidates the cache', async () => {
        const watched = [
            ['local', { userPreferences: { environment: 'free' } }],
            ['sync', { userSiteOverrides: {} }],
            ['sync', { modifiers: {} }],
            ['sync', { environmentConfigs: {} }],
        ];

        for (const [area, items] of watched) {
            const before = fake.reads.local;
            await fake.browser.storage[area].set(items);
            await getConfig();

            assert.equal(fake.reads.local, before + 1, `${Object.keys(items)[0]} in ${area}`);
        }
    });

    test('a statistics write does not churn the cache', async () => {
        await getConfig();
        const before = { ...fake.reads };

        // Written on every conversion batch, and read by nothing in getConfig().
        await local.set({ statistics: { 'yle.fi': { convertedCount: 1 } } });
        await getConfig();

        assert.deepEqual({ ...fake.reads }, before);
    });

    test('an unwatched key in the sync area does not churn the cache either', async () => {
        await getConfig();
        const before = { ...fake.reads };

        await sync.set({ somethingElse: true });
        await getConfig();

        assert.deepEqual({ ...fake.reads }, before);
    });
});

describe('merging stored values over the defaults', () => {
    test('a sync override is applied to a site, and origins are filled in', async () => {
        await sync.set({ userSiteOverrides: { 'yle.fi': { enabled: false } } });
        const config = await getConfig();

        assert.equal(config.siteConfigs['yle.fi'].enabled, false);
        assert.ok(config.siteConfigs['yle.fi'].origins);
    });

    test('the free environment defaults the video modifier to false', async () => {
        await sync.remove(['userSiteOverrides', 'modifiers']);
        await local.set({ userPreferences: { environment: 'free' } });
        const config = await getConfig();

        assert.equal(config.modifiers.aiSlop, true);
        assert.equal(config.modifiers.video, false);
    });

    test('the development environment defaults the video modifier to true', async () => {
        await local.set({ userPreferences: { environment: 'development' } });
        const config = await getConfig();

        assert.equal(config.modifiers.aiSlop, true);
        assert.equal(config.modifiers.video, true);
    });

    test('a sync modifier override wins over the environment default', async () => {
        await local.set({ userPreferences: { environment: 'development' } });
        await sync.set({ modifiers: { video: false } });
        const config = await getConfig();

        assert.equal(config.modifiers.video, false);
    });
});
