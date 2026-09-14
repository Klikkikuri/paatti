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

    test('the free environment leaves the optional modifiers off', async () => {
        await sync.remove(['userSiteOverrides', 'modifiers']);
        await local.set({ userPreferences: { environment: 'free' } });
        const config = await getConfig();

        assert.equal(config.modifiers.aiSlop, true);
        assert.equal(config.modifiers.video, false);
        assert.equal(config.modifiers.converted, false);
    });

    test('the development environment turns the optional modifiers on', async () => {
        await local.set({ userPreferences: { environment: 'development' } });
        const config = await getConfig();

        assert.equal(config.modifiers.aiSlop, true);
        assert.equal(config.modifiers.video, true);
        assert.equal(config.modifiers.converted, true);
    });

    test('a sync modifier override wins over the environment default', async () => {
        await local.set({ userPreferences: { environment: 'development' } });
        await sync.set({ modifiers: { video: false } });
        const config = await getConfig();

        assert.equal(config.modifiers.video, false);
    });
});

describe('providers folded into siteConfigs', () => {
    const url = 'https://provider.example/manifest.json';

    test('an enabled provider\'s site appears in siteConfigs, with a default origin filled in', async () => {
        await sync.set({ providers: [{ url, enabled: true }] });
        await local.set({
            [`provider:${url}`]: { siteConfigs: { 'news.example': { name: 'News', enabled: true, rules: [] } } }
        });

        const config = await getConfig();

        assert.ok(config.siteConfigs['news.example']);
        assert.deepEqual(config.siteConfigs['news.example'].origins, ['https://news.example/*']);
    });

    test('a disabled provider contributes nothing', async () => {
        await sync.set({ providers: [{ url, enabled: false }] });
        await local.set({
            [`provider:${url}`]: { siteConfigs: { 'news.example': { name: 'News', enabled: true, rules: [] } } }
        });

        const config = await getConfig();

        assert.equal(config.siteConfigs['news.example'], undefined);
    });

    test('a provider site is offered but off by default, even though the provider marked it enabled', async () => {
        await sync.set({ providers: [{ url, enabled: true }] });
        await local.set({
            [`provider:${url}`]: {
                siteConfigs: { 'news.example': { name: 'News', enabled: true, origins: ['https://news.example/*'], rules: [] } }
            }
        });

        const config = await getConfig();

        assert.ok(config.siteConfigs['news.example'], 'the site should still be offered, i.e. present');
        assert.equal(config.siteConfigs['news.example'].enabled, false);
    });

    test('a provider marking a site enabled: false withdraws the offer entirely, not just turns it off', async () => {
        await sync.set({ providers: [{ url, enabled: true }] });
        await local.set({
            [`provider:${url}`]: {
                siteConfigs: { 'news.example': { name: 'News', enabled: false, origins: ['https://news.example/*'], rules: [] } }
            }
        });

        const config = await getConfig();

        assert.equal(config.siteConfigs['news.example'], undefined);
    });

    test('a sync override reaches a provider-only domain, exactly as it does a bundled one', async () => {
        await sync.set({
            providers: [{ url, enabled: true }],
            userSiteOverrides: { 'news.example': { enabled: true } }
        });
        await local.set({
            [`provider:${url}`]: {
                siteConfigs: { 'news.example': { name: 'News', enabled: true, origins: ['https://news.example/*'], rules: [] } }
            }
        });

        const config = await getConfig();

        assert.equal(config.siteConfigs['news.example'].enabled, true, 'the user\'s own choice must be able to turn it on');
    });

    test('a provider claiming an existing bundled key replaces it outright', async () => {
        await sync.set({ providers: [{ url, enabled: true }] });
        await local.set({
            [`provider:${url}`]: {
                siteConfigs: { 'yle.fi': { name: 'Provider Yle', enabled: true, origins: ['https://yle.fi/*'], rules: [] } }
            }
        });

        const config = await getConfig();

        assert.equal(config.siteConfigs['yle.fi'].name, 'Provider Yle');
    });

    test('writing a provider\'s resolved data invalidates the cache', async () => {
        await sync.set({ providers: [{ url, enabled: true }] });
        const first = await getConfig();
        const before = fake.reads.local;

        await local.set({ [`provider:${url}`]: { siteConfigs: { 'news.example': { name: 'News', enabled: true, rules: [] } } } });
        const second = await getConfig();

        assert.ok(fake.reads.local > before, 'the cache was not invalidated');
        assert.notEqual(first, second);
        assert.ok(second.siteConfigs['news.example']);
    });
});

describe('the provider safety toggles', () => {
    test('free and paid default both toggles off', async () => {
        await sync.remove(['environmentConfigs']);

        for (const env of ['free', 'paid']) {
            await local.set({ userPreferences: { environment: env } });
            const config = await getConfig();
            assert.equal(config.providerShadowingEnabled, false, env);
            assert.equal(config.loopbackProvidersEnabled, false, env);
        }
    });

    test('development defaults shadowing on, loopback off', async () => {
        await sync.remove(['environmentConfigs']);
        await local.set({ userPreferences: { environment: 'development' } });
        const config = await getConfig();

        assert.equal(config.providerShadowingEnabled, true);
        assert.equal(config.loopbackProvidersEnabled, false);
    });

    test('a local override in development wins over the environment default', async () => {
        await sync.remove(['environmentConfigs']);
        await local.set({
            userPreferences: {
                environment: 'development',
                environmentConfigs: { development: { providerShadowingEnabled: false, loopbackProvidersEnabled: true } }
            }
        });
        const config = await getConfig();

        assert.equal(config.providerShadowingEnabled, false);
        assert.equal(config.loopbackProvidersEnabled, true);
    });

    test('a synced value for either toggle is ignored, even while the local value is false', async () => {
        await local.set({
            userPreferences: {
                environment: 'free',
                environmentConfigs: { free: { providerShadowingEnabled: false, loopbackProvidersEnabled: false } }
            }
        });
        await sync.set({
            environmentConfigs: { free: { providerShadowingEnabled: true, loopbackProvidersEnabled: true } }
        });
        const config = await getConfig();

        assert.equal(config.providerShadowingEnabled, false, 'a synced value turned shadowing on');
        assert.equal(config.loopbackProvidersEnabled, false, 'a synced value turned loopback providers on');
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
