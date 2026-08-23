// An in-memory stand-in for the extension APIs the suites touch, with a storage that really
// dispatches onChanged.
//
// Assign it to globalThis.browser BEFORE the dynamic `await import(...)` of the module under
// test. src/browser-api.js resolves the namespace once, at module evaluation, so a static import
// is hoisted above the assignment and would resolve against nothing. See AGENTS.md.
//
//     const fake = createFakeBrowser({ local: { userPreferences: { enabled: true } } });
//     globalThis.browser = fake.browser;
//     const { getConfig } = await import("../src/config.js");
//
// This module runs no top-level code, so a test runner that picks it up finds no tests.

/** Values cross the storage boundary by structured clone, as they do in a real browser. */
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

/**
 * Resolve a `get` query against a store, matching the WebExtension shapes:
 * undefined/null (everything), a string, an array of strings, or an object of defaults.
 */
function selectKeys(store, query) {
    if (query === undefined || query === null) return clone(store);

    if (typeof query === "string") {
        return query in store ? { [query]: clone(store[query]) } : {};
    }

    if (Array.isArray(query)) {
        const result = {};
        for (const key of query) {
            if (key in store) result[key] = clone(store[key]);
        }
        return result;
    }

    const result = {};
    for (const [key, fallback] of Object.entries(query)) {
        result[key] = key in store ? clone(store[key]) : clone(fallback);
    }
    return result;
}

/** addListener/removeListener/hasListener over an array, so registration order is observable. */
function createEvent() {
    const listeners = [];

    return {
        listeners,
        addListener: (fn) => { listeners.push(fn); },
        removeListener: (fn) => {
            const index = listeners.indexOf(fn);
            if (index !== -1) listeners.splice(index, 1);
        },
        hasListener: (fn) => listeners.includes(fn),
        emit: (...args) => {
            // Copied: a listener that unsubscribes must not shift the ones still to run.
            for (const fn of [...listeners]) fn(...args);
        },
    };
}

/**
 * A fake `browser` namespace plus the controls the suites need.
 *
 * @param {Object} [seed]
 * @param {Object} [seed.local] - Initial browser.storage.local contents.
 * @param {Object} [seed.sync] - Initial browser.storage.sync contents.
 * @param {Object} [seed.messages] - i18n message table; an unlisted key returns "".
 * @returns {{browser: Object, reads: Object, deferNextGet: Function, reset: Function}}
 */
function createFakeBrowser({ local = {}, sync = {}, messages = {} } = {}) {
    const stores = { local: clone(local), sync: clone(sync) };
    const reads = { local: 0, sync: 0 };
    const pendingGets = { local: null, sync: null };

    // Fires for every area; src/options/popup.js listens on the area-scoped one instead.
    const onChanged = createEvent();
    const areaEvents = { local: createEvent(), sync: createEvent() };

    function dispatch(areaName, changes) {
        if (Object.keys(changes).length === 0) return;

        onChanged.emit(changes, areaName);
        areaEvents[areaName].emit(changes);
    }

    function createArea(areaName) {
        const store = () => stores[areaName];

        return {
            onChanged: areaEvents[areaName],

            get: async (query) => {
                reads[areaName]++;
                // Answered from the state at call time, as a real read is: a parked read that
                // lands after a later write still delivers what it saw.
                const answer = selectKeys(store(), query);

                // deferNextGet() parks this read so a test can resolve two reads out of order.
                const gate = pendingGets[areaName];
                if (gate) {
                    pendingGets[areaName] = null;
                    await gate;
                }

                return answer;
            },

            set: async (items) => {
                const changes = {};
                for (const [key, value] of Object.entries(items)) {
                    // oldValue is absent for a key that did not exist, as in a real browser.
                    if (key in store()) changes[key] = { oldValue: clone(store()[key]) };
                    else changes[key] = {};

                    store()[key] = clone(value);
                    changes[key].newValue = clone(value);
                }
                dispatch(areaName, changes);
            },

            remove: async (keys) => {
                const changes = {};
                for (const key of [].concat(keys)) {
                    if (!(key in store())) continue;

                    changes[key] = { oldValue: clone(store()[key]) };
                    delete store()[key];
                }
                dispatch(areaName, changes);
            },

            clear: async () => {
                const changes = {};
                for (const [key, value] of Object.entries(store())) {
                    changes[key] = { oldValue: clone(value) };
                }
                stores[areaName] = {};
                dispatch(areaName, changes);
            },
        };
    }

    const browser = {
        storage: {
            local: createArea("local"),
            sync: createArea("sync"),
            onChanged,
        },
        i18n: {
            getMessage: (key, substitutions) => {
                const message = messages[key];
                if (message === undefined) return "";

                return [].concat(substitutions ?? []).reduce((text, value, index) => {
                    return text.replaceAll(`$${index + 1}`, value);
                }, message);
            },
        },
        permissions: {
            contains: async () => true,
            request: async () => true,
            remove: async () => true,
        },
        tabs: {
            query: async () => [],
            sendMessage: async () => undefined,
        },
        runtime: {
            getURL: (path) => `chrome-extension://fake/${path}`,
            getManifest: () => ({ version: "0.0.0" }),
        },
    };

    return {
        browser,
        reads,

        /**
         * Park the next `get` on this area until the returned function is called, so a test can
         * land a slower read after a faster one.
         */
        deferNextGet: (areaName) => {
            let release;
            pendingGets[areaName] = new Promise((resolve) => { release = resolve; });
            return release;
        },

        /** Drop every listener and read count; leaves stored data alone. */
        reset: () => {
            onChanged.listeners.length = 0;
            areaEvents.local.listeners.length = 0;
            areaEvents.sync.listeners.length = 0;
            reads.local = 0;
            reads.sync = 0;
        },
    };
}

export { createFakeBrowser };
