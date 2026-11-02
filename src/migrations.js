"use strict";

import browser from "./browser-api.js";
import { getLogger } from "./utils.js";

const log = getLogger("migrations");

/** The key in storage.local that holds the id of the last migration that ran. */
const VERSION_KEY = "storageSchemaVersion";

/** The key in storage.local that holds the record of the last failed migration, if there is one. */
const FAILURE_KEY = "migrationFailure";

/**
 * The migrations of the stored data, in the order they must run.
 *
 * A migration is `{ id, name, run }`. `run()` changes storage.local and returns when the change is written.
 *
 * ## Rules
 * - **Append-only.** Never edit, reorder or renumber an entry that has shipped. Add the next integer id.
 * - **Idempotent.** Running it twice, or again after a partial write, must converge.
 * - **Never throw on an unexpected shape.** A non-array index, a non-object namespace or a `providers` value
 *   that is not an array means "nothing to migrate". A throw blocks every later migration permanently,
 *   because a deterministic failure repeats on every service-worker start.
 * - **`storage.local` only.** `storage.sync` is shared with the user's other devices, which can run an
 *   older version of the extension. Change synced data only in a way that an older version can still read.
 * - **No app imports and no defaults.** Reach `browser.storage` directly, so a later change to a module
 *   cannot change what a shipped migration does. Defaults live in the read path (`emptyProviderData()`,
 *   `getConfig()`), because a fresh install runs the whole chain.
 * - **Never lower the stamp.** A stamp newer than this build's list is left alone.
 * - **Keep the read-time fallback** for an old shape until its migration has shipped for a release.
 *
 * @type {Array<{id: number, name: string, run: () => Promise<void>}>}
 */
const migrations = [
    {
        id: 1,
        name: "drop-stale-provider-data",
        run: async () => {
            const { providers } = await browser.storage.sync.get("providers");
            if (!Array.isArray(providers)) return;

            for (const provider of providers) {
                const url = provider && provider.url;
                if (!url) continue;

                const namespace = `provider:${url}`;
                const indexKey = `${namespace}_index`;
                const stored = await browser.storage.local.get([namespace, indexKey]);
                const data = stored[namespace];
                if (!data || typeof data !== "object") continue;

                const stale = ["scope", "rejected"].filter((key) => key in data);
                if (stale.length === 0) continue;

                for (const key of stale) delete data[key];

                // Read-modify-write. An options-page save that lands in this window is lost; the window is
                // milliseconds on the first start after an upgrade, and the next refresh writes the rest.
                const update = { [namespace]: data };
                if (Array.isArray(stored[indexKey])) {
                    update[indexKey] = stored[indexKey].filter((key) => !stale.includes(key));
                }
                await browser.storage.local.set(update);
            }
        },
    },
    {
        id: 2,
        name: "remove-rahti-data",
        run: async () => {
            await browser.storage.local.remove([
                "rahtiData", "rahtiData_index", "rahtiHeaders", "lastDatabaseUpdate",
            ]);
        },
    },
];

/**
 * The stored schema version, or 0 when nothing is stamped or the stamp is not an integer.
 *
 * @returns {Promise<number>}
 */
async function readStamp() {
    const { [VERSION_KEY]: stamp } = await browser.storage.local.get(VERSION_KEY);
    if (stamp !== undefined && !Number.isInteger(stamp)) log("Ignoring an unusable schema version:", stamp);
    return Number.isInteger(stamp) ? stamp : 0;
}

/**
 * Record why the chain stopped, so that a field report can say which migration failed and how often.
 *
 * Keeps its own failure quiet: when storage is what is failing, this write fails too, and the promise
 * that `runMigrations()` returns must still resolve.
 *
 * @param {{id: number, name: string}|null} migration - The migration that threw, or null when the stamp
 *   read threw before any migration started.
 * @param {unknown} error
 * @returns {Promise<void>}
 */
async function recordFailure(migration, error) {
    try {
        const { [FAILURE_KEY]: previous } = await browser.storage.local.get(FAILURE_KEY);
        const attempts = Number.isInteger(previous?.attempts) ? previous.attempts + 1 : 1;
        await browser.storage.local.set({
            [FAILURE_KEY]: {
                failedId: migration ? migration.id : null,
                name: migration ? migration.name : "read-version",
                error: String(error),
                attempts,
                at: Date.now(),
            },
        });
    } catch (writeError) {
        log("Could not record the migration failure:", writeError);
    }
}

/**
 * Apply every migration that this build has and the stored data has not.
 *
 * Runs on every service-worker start, so a migration that failed retries on the next start. Never rejects:
 * a caller awaits it with no `catch`, and a failure is recorded in storage.local instead.
 *
 * @param {Array<{id: number, name: string, run: () => Promise<void>}>} [list] - The migrations to apply.
 *   Defaults to this build's list; a test passes its own.
 * @returns {Promise<void>}
 */
async function runMigrations(list = migrations) {
    let stamp;
    try {
        stamp = await readStamp();
    } catch (error) {
        // No migration started, so there is no id to name.
        log("Could not read the stored schema version:", error);
        await recordFailure(null, error);
        return;
    }

    const latest = list.reduce((max, migration) => Math.max(max, migration.id), 0);
    if (stamp > latest) {
        log(`Stored schema version ${stamp} is newer than this build's ${latest}; nothing to do.`);
        return;
    }

    for (const migration of list) {
        if (migration.id <= stamp) continue;
        try {
            await migration.run();
            await browser.storage.local.set({ [VERSION_KEY]: migration.id });
        } catch (error) {
            // The stamp stays put, so this migration runs again on the next start.
            log(`Migration ${migration.id} (${migration.name}) failed:`, error);
            await recordFailure(migration, error);
            return;
        }
    }

    try {
        await browser.storage.local.remove(FAILURE_KEY);
    } catch (error) {
        // The chain succeeded. A record that cannot be cleared is not a migration failure.
        log("Could not clear the migration failure record:", error);
    }
}

export { migrations, runMigrations };
