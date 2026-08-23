import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { fetchRahtiData, fetchRahtiDataWithRetry } = await import('../src/rahti.js');

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
