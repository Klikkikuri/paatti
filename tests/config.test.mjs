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
const { getConfig, onConfigValue } = await import('../src/config.js');

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

/** Drain every pending microtask, so a publish that is going to happen has happened. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('onConfigValue', () => {
    test('calls back once with the value in storage now', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 3 } });

        const seen = [];
        const unsubscribe = onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value));
        await flush();
        unsubscribe();

        assert.deepEqual(seen, [3]);
    });

    test('the first call happens even when the value is false or undefined', async () => {
        await local.set({ userPreferences: { enabled: false } });

        const seen = [];
        const stop = [
            onConfigValue((c) => c.enabled, (value) => seen.push(value)),
            onConfigValue(() => undefined, (value) => seen.push(value)),
        ];
        await flush();
        stop.forEach((unsubscribe) => unsubscribe());

        assert.deepEqual(seen, [false, undefined]);
    });

    test('calls back again only when the selected value genuinely changes', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 1 } });

        const seen = [];
        const unsubscribe = onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value));
        await flush();

        // A watched key, but the selected value is unmoved.
        await local.set({ userPreferences: { clickbaitLevel: 1 } });
        await flush();

        await local.set({ userPreferences: { clickbaitLevel: 2 } });
        await flush();
        unsubscribe();

        assert.deepEqual(seen, [1, 2]);
    });

    test('does not call back for a write it does not watch', async () => {
        const seen = [];
        const unsubscribe = onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value));
        await flush();

        await local.set({ statistics: { 'yle.fi': { convertedCount: 1 } } });
        await flush();
        unsubscribe();

        assert.equal(seen.length, 1);
    });

    test('stops calling back after unsubscribe', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 1 } });

        const seen = [];
        const unsubscribe = onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value));
        await flush();
        unsubscribe();

        await local.set({ userPreferences: { clickbaitLevel: 4 } });
        await flush();

        assert.deepEqual(seen, [1]);
    });

    test('a throwing selector or callback leaves the other subscriptions working', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 1 } });

        const seen = [];
        const stop = [
            onConfigValue(() => { throw new Error('selector blew up'); }, () => seen.push('bad-selector')),
            onConfigValue((c) => c.clickbaitLevel, () => { throw new Error('callback blew up'); }),
            onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value)),
        ];
        await flush();

        await local.set({ userPreferences: { clickbaitLevel: 2 } });
        await flush();
        stop.forEach((unsubscribe) => unsubscribe());

        assert.deepEqual(seen, [1, 2]);
    });

    test('a burst of writes delivers the last value last, even when reads resolve out of order', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 0 } });

        const seen = [];
        const unsubscribe = onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value));
        await flush();

        // Park the read the first write triggers, then land a second write behind it.
        const release = fake.deferNextGet('local');
        await local.set({ userPreferences: { clickbaitLevel: 1 } });
        await local.set({ userPreferences: { clickbaitLevel: 2 } });
        release();
        await flush();
        unsubscribe();

        assert.equal(seen.at(-1), 2, `saw ${JSON.stringify(seen)}`);
    });

    test('a failed read does not stop later publishes', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 1 } });

        const seen = [];
        const unsubscribe = onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(value));
        await flush();

        const realGet = local.get;
        local.get = async () => { throw new Error('storage unavailable'); };
        await local.set({ userPreferences: { clickbaitLevel: 2 } });
        await flush();
        local.get = realGet;

        await local.set({ userPreferences: { clickbaitLevel: 3 } });
        await flush();
        unsubscribe();

        assert.deepEqual(seen, [1, 3]);
    });

    test('a callback may unsubscribe a sibling without skipping the rest', async () => {
        await local.set({ userPreferences: { clickbaitLevel: 1 } });

        const seen = [];
        let dropSibling = () => {};
        const stop = [
            onConfigValue((c) => c.clickbaitLevel, () => dropSibling()),
            onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(`sibling:${value}`)),
            onConfigValue((c) => c.clickbaitLevel, (value) => seen.push(`last:${value}`)),
        ];
        dropSibling = stop[1];
        await flush();

        await local.set({ userPreferences: { clickbaitLevel: 2 } });
        await flush();
        stop.forEach((unsubscribe) => unsubscribe());

        // The sibling is dropped during the first publish, before the iterator reaches it;
        // the third subscription must still be called, on both publishes.
        assert.deepEqual(seen, ['last:1', 'last:2']);
    });
});
