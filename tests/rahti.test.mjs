import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { getRahtiEntry } = await import('../src/rahti.js');
const { setProviderEnabled, removeProvider } = await import('../src/providers.js');

beforeEach(async () => {
    await fake.browser.storage.local.clear();
    await fake.browser.storage.sync.clear();
});

const site = (key) => ({ name: key, enabled: true, origins: [`https://${key}/*`], rules: [] });

/** Registers a provider (default or third-party) with the given resolved rahtiData, optionally
 *  declaring `key` as a site it covers via site-configs. */
async function seedProvider(url, key, rahtiData) {
    const { providers } = await fake.browser.storage.sync.get('providers');
    await fake.browser.storage.sync.set({ providers: [...(providers || []), { url, enabled: true }] });
    await fake.browser.storage.local.set({
        [`provider:${url}`]: { siteConfigs: key ? { [key]: site(key) } : {}, rahtiData }
    });
}

/** Sets the active ("free", the default test environment) environment's defaultProviders list. */
async function setDefaultProviders(urls) {
    const data = await fake.browser.storage.local.get('userPreferences');
    const userPreferences = data.userPreferences || {};
    userPreferences.environmentConfigs = userPreferences.environmentConfigs || {};
    userPreferences.environmentConfigs.free = { ...userPreferences.environmentConfigs.free, defaultProviders: urls };
    await fake.browser.storage.local.set({ userPreferences });
}

describe('getRahtiEntry', () => {
    test('a sign with no provider covering the host resolves against the default provider\'s data', async () => {
        const defaultUrl = 'https://default.example/manifest.json';
        await setDefaultProviders([defaultUrl]);
        await seedProvider(defaultUrl, null, { 'sign-1': { title: 'Default entry' } });

        const entry = await getRahtiEntry('sign-1', 'no-provider-covers-this.example');

        assert.deepEqual(entry, { title: 'Default entry' });
    });

    test('a link host a provider declares resolves against that provider\'s own data, not the default provider', async () => {
        const defaultUrl = 'https://default.example/manifest.json';
        await setDefaultProviders([defaultUrl]);
        await seedProvider(defaultUrl, null, { 'shared-sign': { title: 'Default entry' } });
        await seedProvider('https://provider.example/manifest.json', 'provider-only.example',
            { 'shared-sign': { title: 'Provider entry' } });

        const entry = await getRahtiEntry('shared-sign', 'provider-only.example');

        assert.deepEqual(entry, { title: 'Provider entry' });
    });

    test('a provider covering the host but lacking the sign returns null, not the default entry', async () => {
        const defaultUrl = 'https://default.example/manifest.json';
        await setDefaultProviders([defaultUrl]);
        await seedProvider(defaultUrl, null, { 'not-in-provider': { title: 'Default entry' } });
        await seedProvider('https://provider.example/manifest.json', 'provider-only-2.example', {});

        const entry = await getRahtiEntry('not-in-provider', 'provider-only-2.example');

        assert.equal(entry, null);
    });

    test('disabling the default provider makes a previously-resolved sign return null', async () => {
        const defaultUrl = 'https://default.example/manifest.json';
        await setDefaultProviders([defaultUrl]);
        await seedProvider(defaultUrl, null, { 'sign-2': { title: 'Default entry' } });
        assert.deepEqual(await getRahtiEntry('sign-2', 'no-provider.example'), { title: 'Default entry' });

        await setProviderEnabled(defaultUrl, false);

        assert.equal(await getRahtiEntry('sign-2', 'no-provider.example'), null);
    });

    test('removing the default provider makes a previously-resolved sign return null', async () => {
        const defaultUrl = 'https://default.example/manifest.json';
        await setDefaultProviders([defaultUrl]);
        await seedProvider(defaultUrl, null, { 'sign-3': { title: 'Default entry' } });
        assert.deepEqual(await getRahtiEntry('sign-3', 'no-provider.example'), { title: 'Default entry' });

        await removeProvider(defaultUrl);

        assert.equal(await getRahtiEntry('sign-3', 'no-provider.example'), null);
    });

    test('two default providers merge with later-wins precedence on a colliding sign', async () => {
        const urlA = 'https://default-a.example/manifest.json';
        const urlB = 'https://default-b.example/manifest.json';
        await setDefaultProviders([urlA, urlB]);
        await seedProvider(urlA, null, { 'colliding-sign': { title: 'From A' } });
        await seedProvider(urlB, null, { 'colliding-sign': { title: 'From B' } });

        const entry = await getRahtiEntry('colliding-sign', 'no-provider.example');

        assert.deepEqual(entry, { title: 'From B' });
    });

    test('no default provider configured resolves to null, not a throw', async () => {
        await setDefaultProviders([]);

        assert.equal(await getRahtiEntry('any-sign', 'no-provider.example'), null);
    });
});
