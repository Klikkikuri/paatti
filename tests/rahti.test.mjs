import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { fetchRahtiData, fetchRahtiDataWithRetry, rahtiStorage, getRahtiEntry } = await import('../src/rahti.js');

let fetchAttempts = 0;

/** A payload the schema check accepts, so only the retry behaviour is under test. */
const okResponse = (entries = []) => ({
    ok: true,
    status: 200,
    headers: new Map([
        ['ETag', '"test-etag"'],
        ['Last-Modified', 'Sun, 26 Jul 2026 12:00:00 GMT']
    ]),
    json: async () => ({
        status: 'ok',
        schema_version: '0.1.0',
        updated: '2026-07-26T12:00:00Z',
        entries
    })
});

beforeEach(async () => {
    fetchAttempts = 0;
    // The namespace object is resolved once at import, so empty the store rather than replace it.
    await fake.browser.storage.local.clear();
    await fake.browser.storage.sync.clear();
});

test('fetchRahtiDataWithRetry succeeds on the 2nd attempt after a network reconnect', async () => {
    globalThis.fetch = async () => {
        fetchAttempts++;
        if (fetchAttempts < 2) throw new Error('Simulated network offline during wake-up');

        return okResponse([{ urls: [{ sign: 'testsign123' }], title: 'Test Headline' }]);
    };

    const result = await fetchRahtiDataWithRetry({}, { maxRetries: 2, initialDelayMs: 10, backoffFactor: 1 });

    assert.equal(result, true);
    assert.equal(fetchAttempts, 2);
});

test('a direct fetchRahtiData call fails immediately, without retrying', async () => {
    globalThis.fetch = async () => {
        fetchAttempts++;
        throw new Error('Simulated network error on manual click');
    };

    assert.equal(await fetchRahtiData({ force: true }), false);
    assert.equal(fetchAttempts, 1);
});

test('fetchRahtiDataWithRetry stops after maxRetries while the network stays offline', async () => {
    globalThis.fetch = async () => {
        fetchAttempts++;
        throw new Error('Simulated network still offline');
    };

    const maxRetries = 2;
    const result = await fetchRahtiDataWithRetry({}, { maxRetries, initialDelayMs: 10, backoffFactor: 1 });

    assert.equal(result, false);
    assert.equal(fetchAttempts, maxRetries + 1);
});

test('the in-flight lock deduplicates concurrent calls into one execution', async () => {
    globalThis.fetch = async () => {
        fetchAttempts++;
        await new Promise((resolve) => setTimeout(resolve, 50));

        return okResponse();
    };

    const results = await Promise.all([fetchRahtiData(), fetchRahtiData(), fetchRahtiData()]);

    assert.equal(fetchAttempts, 1);
    assert.deepEqual(results, [true, true, true]);
});

const providerUrl = 'https://provider.example/manifest.json';
const site = (key) => ({ name: key, enabled: true, origins: [`https://${key}/*`], rules: [] });

/** Registers a provider whose declared scope covers `key`, with the given resolved rahtiData. */
async function seedProvider(key, rahtiData) {
    await fake.browser.storage.sync.set({ providers: [{ url: providerUrl, enabled: true }] });
    await fake.browser.storage.local.set({
        [`provider:${providerUrl}`]: { siteConfigs: { [key]: site(key) }, rahtiData }
    });
}

describe('getRahtiEntry', () => {
    test('a sign with no provider covering the link host resolves against the bundled set', async () => {
        (await rahtiStorage).store({ 'getRahtiEntry-bundled-1': { title: 'Bundled entry' } });

        const entry = await getRahtiEntry('getRahtiEntry-bundled-1', 'no-provider-covers-this.example');

        assert.deepEqual(entry, { title: 'Bundled entry' });
    });

    test('a link host a provider declares resolves against that provider\'s own data, not the bundled set', async () => {
        (await rahtiStorage).store({ 'getRahtiEntry-shared-sign': { title: 'Bundled entry' } });
        await seedProvider('provider-only.example', { 'getRahtiEntry-shared-sign': { title: 'Provider entry' } });

        const entry = await getRahtiEntry('getRahtiEntry-shared-sign', 'provider-only.example');

        assert.deepEqual(entry, { title: 'Provider entry' });
    });

    test('a provider covering the host but lacking the sign returns null, not the bundled entry', async () => {
        (await rahtiStorage).store({ 'getRahtiEntry-not-in-provider': { title: 'Bundled entry' } });
        await seedProvider('provider-only-2.example', {});

        const entry = await getRahtiEntry('getRahtiEntry-not-in-provider', 'provider-only-2.example');

        assert.equal(entry, null);
    });
});
