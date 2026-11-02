import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { migrations, runMigrations } = await import('../src/migrations.js');
const { PROVIDER_KEY_PREFIX } = await import('../src/config.js');

const LOCAL = fake.browser.storage.local;
const SYNC = fake.browser.storage.sync;

const PROVIDER_URL = 'https://provider.example/manifest.json';
const NAMESPACE = `${PROVIDER_KEY_PREFIX}${PROVIDER_URL}`;
const INDEX_KEY = `${NAMESPACE}_index`;
const LATEST_ID = migrations[migrations.length - 1].id;
const STAMP_KEY = 'storageSchemaVersion';
const FAILURE_KEY = 'migrationFailure';
const RAHTI_KEYS = ['rahtiData', 'rahtiData_index', 'rahtiHeaders', 'lastDatabaseUpdate'];

beforeEach(async () => {
    await LOCAL.clear();
    await SYNC.clear();
});

/**
 * A storage.local namespace as an older version wrote it: `scope` and `rejected` beside the content that
 * this version still reads.
 */
const staleNamespace = () => ({
    scope: ['news.example'],
    rejected: [{ key: 'yle.fi', reason: 'already claimed; shadowing is disabled' }],
    siteConfigs: { 'news.example': { name: 'News', enabled: true, rules: [] } },
});

/**
 * The store as an existing user has it on the first start of this build: the provider list in sync, its
 * content in local, the whole old Rahti database beside them.
 */
async function seedOldStore() {
    await SYNC.set({ providers: [{ url: PROVIDER_URL, enabled: true }] });
    await LOCAL.set({
        [NAMESPACE]: staleNamespace(),
        [INDEX_KEY]: ['scope', 'rejected', 'siteConfigs'],
        rahtiData: { s1: { title: 'one' } },
        rahtiData_index: ['s1'],
        rahtiHeaders: { 'https://provider.example': { etag: '"v1"' } },
        lastDatabaseUpdate: 1788000000000,
    });
}

describe('the migration list', () => {
    test('ids are unique and strictly increasing', () => {
        const ids = migrations.map((migration) => migration.id);

        assert.deepEqual(ids, [...new Set(ids)], 'every id is unique');
        for (let i = 1; i < ids.length; i++) {
            assert.ok(ids[i] > ids[i - 1], `id ${ids[i]} follows ${ids[i - 1]}`);
        }
    });

    test('the provider prefix is the one config.js uses', () => {
        // A different prefix means the stored namespaces moved. Add a new migration; do not edit migration 1.
        assert.equal(PROVIDER_KEY_PREFIX, 'provider:');
    });
});

describe('runMigrations', () => {
    test('an empty store changes nothing but the stamp', async () => {
        await runMigrations();

        assert.deepEqual(await LOCAL.get(null), { [STAMP_KEY]: LATEST_ID });
    });

    test('a synced provider list with no local namespace writes no namespace key', async () => {
        // A second device: the provider list synced over, the resolved content never did.
        await SYNC.set({ providers: [{ url: PROVIDER_URL, enabled: true }] });

        await runMigrations();

        assert.deepEqual(Object.keys(await LOCAL.get(null)), [STAMP_KEY]);
    });

    test('the whole chain is idempotent on a populated store', async () => {
        await seedOldStore();

        await runMigrations();
        const once = await LOCAL.get(null);
        await runMigrations();

        assert.deepEqual(await LOCAL.get(null), once);
        assert.equal(once[STAMP_KEY], LATEST_ID);
        assert.equal(once[FAILURE_KEY], undefined);
    });

    test('a stamp above the latest id runs nothing and writes nothing', async () => {
        const newer = { [STAMP_KEY]: 99, rahtiData: { s1: { title: 'one' } } };
        await LOCAL.set(newer);

        await runMigrations();

        assert.deepEqual(await LOCAL.get(null), newer);
    });

    test('an unusable stamp is treated as 0', async () => {
        await seedOldStore();
        await LOCAL.set({ [STAMP_KEY]: 'two' });

        await runMigrations();

        assert.equal((await LOCAL.get(STAMP_KEY))[STAMP_KEY], LATEST_ID);
        assert.deepEqual((await LOCAL.get(NAMESPACE))[NAMESPACE], { siteConfigs: staleNamespace().siteConfigs });
    });
});

describe('migration 1, drop-stale-provider-data', () => {
    test('drops scope and rejected from the namespace and from its index', async () => {
        await seedOldStore();

        await runMigrations();

        const data = (await LOCAL.get(NAMESPACE))[NAMESPACE];
        assert.deepEqual(Object.keys(data), ['siteConfigs']);
        assert.deepEqual((await LOCAL.get(INDEX_KEY))[INDEX_KEY], ['siteConfigs']);
        assert.ok(data.siteConfigs['news.example']);
    });

    test('leaves a namespace without the stale fields untouched', async () => {
        await SYNC.set({ providers: [{ url: PROVIDER_URL, enabled: true }] });
        const clean = { siteConfigs: { 'news.example': { name: 'News', enabled: true, rules: [] } } };
        await LOCAL.set({ [NAMESPACE]: clean, [INDEX_KEY]: ['siteConfigs'] });

        await runMigrations();

        assert.deepEqual((await LOCAL.get(NAMESPACE))[NAMESPACE], clean);
    });

    test('tolerates a namespace that is not an object', async () => {
        await SYNC.set({ providers: [{ url: PROVIDER_URL, enabled: true }] });
        await LOCAL.set({ [NAMESPACE]: 'not an object', [INDEX_KEY]: ['scope'] });

        await runMigrations();

        const stored = await LOCAL.get(null);
        assert.equal(stored[NAMESPACE], 'not an object');
        assert.deepEqual(stored[INDEX_KEY], ['scope']);
        assert.equal(stored[STAMP_KEY], LATEST_ID);
    });

    test('tolerates an index that is not an array', async () => {
        await SYNC.set({ providers: [{ url: PROVIDER_URL, enabled: true }] });
        await LOCAL.set({ [NAMESPACE]: { scope: ['news.example'], siteConfigs: {} }, [INDEX_KEY]: 'not an array' });

        await runMigrations();

        const stored = await LOCAL.get(null);
        assert.deepEqual(stored[NAMESPACE], { siteConfigs: {} });
        assert.equal(stored[INDEX_KEY], 'not an array');
    });
});

describe('migration 2, remove-rahti-data', () => {
    test('removes the four keys of the retired fetcher and keeps a sibling', async () => {
        await seedOldStore();
        await LOCAL.set({ statistics: { 'news.example': { totalConversions: 1 } } });

        await runMigrations();

        const stored = await LOCAL.get(null);
        for (const key of RAHTI_KEYS) assert.ok(!(key in stored), `${key} is removed`);
        assert.deepEqual(stored.statistics, { 'news.example': { totalConversions: 1 } });
    });
});

describe('failure handling', () => {
    /** A migration that writes a key and then throws, as a crash mid-chain looks. */
    const partialWrite = (throwOnRun) => ({
        id: 1,
        name: 'writes-then-throws',
        run: async () => {
            await LOCAL.set({ written: true });
            if (throwOnRun.value) throw new Error('boom');
        },
    });

    test('keeps the stamp and records which migration failed', async () => {
        await runMigrations([partialWrite({ value: true })]);

        const stored = await LOCAL.get(null);
        assert.equal(stored.written, true);
        assert.equal(stored[STAMP_KEY], undefined, 'the stamp does not advance past the failure');
        assert.equal(stored[FAILURE_KEY].failedId, 1);
        assert.equal(stored[FAILURE_KEY].name, 'writes-then-throws');
        assert.equal(stored[FAILURE_KEY].attempts, 1);
        assert.equal(typeof stored[FAILURE_KEY].at, 'number');
        assert.match(stored[FAILURE_KEY].error, /boom/);
    });

    test('counts the attempts of a failure that repeats', async () => {
        await runMigrations([partialWrite({ value: true })]);
        await runMigrations([partialWrite({ value: true })]);

        assert.equal((await LOCAL.get(FAILURE_KEY))[FAILURE_KEY].attempts, 2);
    });

    test('a rerun after a partial write converges and clears the failure', async () => {
        const throwOnRun = { value: true };
        const list = [partialWrite(throwOnRun)];

        await runMigrations(list);
        throwOnRun.value = false;
        await runMigrations(list);

        const stored = await LOCAL.get(null);
        assert.equal(stored.written, true);
        assert.equal(stored[STAMP_KEY], 1);
        assert.ok(!(FAILURE_KEY in stored), 'the failure record is gone');
    });

    test('a failing stamp read still resolves, and records read-version', async () => {
        const original = LOCAL.get;
        LOCAL.get = async (query) => {
            if (query === STAMP_KEY) throw new Error('storage is gone');
            return original(query);
        };
        try {
            await assert.doesNotReject(runMigrations());
        } finally {
            LOCAL.get = original;
        }

        const failure = (await LOCAL.get(FAILURE_KEY))[FAILURE_KEY];
        assert.equal(failure.failedId, null);
        assert.equal(failure.name, 'read-version');
        assert.match(failure.error, /storage is gone/);
    });

    test('a failing failure-record write still resolves', async () => {
        const original = LOCAL.set;
        LOCAL.set = async () => { throw new Error('storage is gone'); };
        try {
            await assert.doesNotReject(runMigrations([partialWrite({ value: true })]));
        } finally {
            LOCAL.set = original;
        }
    });

    test('a failing version write is attributed to the migration that ran', async () => {
        const original = LOCAL.set;
        LOCAL.set = async (items) => {
            if (STAMP_KEY in items) throw new Error('storage is gone');
            return original(items);
        };
        try {
            await assert.doesNotReject(runMigrations([{ id: 1, name: 'writes-nothing', run: async () => {} }]));
        } finally {
            LOCAL.set = original;
        }

        const failure = (await LOCAL.get(FAILURE_KEY))[FAILURE_KEY];
        assert.equal(failure.failedId, 1);
        assert.equal(failure.name, 'writes-nothing');
    });

    test('a record that cannot be cleared after a successful chain is not a migration failure', async () => {
        const original = LOCAL.remove;
        LOCAL.remove = async (keys) => {
            if ([].concat(keys).includes(FAILURE_KEY)) throw new Error('storage is gone');
            return original(keys);
        };
        try {
            await assert.doesNotReject(runMigrations());
        } finally {
            LOCAL.remove = original;
        }

        const stored = await LOCAL.get(null);
        assert.equal(stored[STAMP_KEY], LATEST_ID);
        assert.ok(!(FAILURE_KEY in stored), 'no failure is recorded for a chain that succeeded');
    });
});
