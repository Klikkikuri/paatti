import { browser, getLogger } from "./utils.js";

const log = getLogger("storage");

/**
 * Storage class with indexed key tracking.
 * Maintains an index of all keys for efficient key enumeration.
 */
class Storage {
    /**
     * Creates a new Storage instance.
     * @param {string} ns - The namespace for this storage instance.
     * @param {Object} [data={}] - Initial data object.
     * @param {Set} [index=new Set()] - Initial index of keys.
     */
    constructor(ns, data, index) {
        this.data = data || {};
        this.index = index || new Set();
        this.ns = ns;
        this.indexKey = `${ns}_index`;
    }

    /**
     * Sets a key-value pair in storage and updates the index.
     * @param {string} key - The key to set.
     * @param {*} value - The value to store.
     */
    async set(key, value) {
        this.data[key] = value;
        this.index.add(key);
        await browser().storage.local.set({ 
            [this.ns]: this.data,
            [this.indexKey]: Array.from(this.index)
        });
    }

    /**
     * Retrieves a value from storage by key.
     * @param {string} key - The key to retrieve.
     * @returns {Promise<*|null>} The stored value or null if not found.
     */
    async get(key) {
        if (key in this.data) {
            return this.data[key];
        }
        return null;
    }

    /**
     * Deletes a key-value pair from storage and removes it from the index.
     * @param {string} key - The key to delete.
     */
    async delete(key) {
        delete this.data[key];
        this.index.delete(key);
        await browser().storage.local.set({ 
            [this.ns]: this.data,
            [this.indexKey]: Array.from(this.index)
        });
    }

    /**
     * Loads multiple key-value pairs into storage at once.
     * More efficient than calling set() multiple times.
     * @param {Object} entries - An object containing key-value pairs to load.
     */
    async store(entries) {
        Object.assign(this.data, entries);
        Object.keys(entries).forEach(key => this.index.add(key));
        await browser().storage.local.set({ 
            [this.ns]: this.data,
            [this.indexKey]: Array.from(this.index)
        });
    }

    

    /**
     * Removes multiple keys from storage at once.
     * More efficient than calling delete() multiple times.
     * @param {string[]} keys - An array of keys to remove.
     */
    async remove(keys) {
        keys.forEach(key => {
            delete this.data[key];
            this.index.delete(key);
        });
        await browser().storage.local.set({ 
            [this.ns]: this.data,
            [this.indexKey]: Array.from(this.index)
        });
    }

    /**
     * Returns all keys currently in the index.
     * @returns {string[]} Array of all indexed keys.
     */
    getKeys() {
        return Array.from(this.index);
    }

    /**
     * Removes all storage entries for this namespace and clears local data.
     */
    async prune() {
        const allData = await browser().storage.local.get(null);
        // Identify keys that start with the namespace
        const keysToRemove = Object.keys(allData).filter(key => 
            key.startsWith(this.ns)
        );
        if (keysToRemove.length > 0) {
            await browser().storage.local.remove(keysToRemove);
            console.debug(`Pruned ${keysToRemove.length} entries from namespace: ${this.ns}`);
        }
        // Clear local data and index
        this.data = {};
        this.index = new Set();
    }
}

/**
 * Initializes a Storage instance by loading existing data and index from browser storage.
 * @returns {Promise<Storage>} A fully initialized Storage instance.
 */
const initStorage = async (ns) => {
    const indexKey = `${ns}_index`;
    const stored = await browser().storage.local.get([ns, indexKey]);
    const data = stored[ns] || {};
    const index = stored[indexKey] ? new Set(stored[indexKey]) : new Set(Object.keys(data));
    log(`Initialized storage for namespace: ${ns} with ${index.size} keys.`);
    return new Storage(ns, data, index);
};

export { initStorage };
