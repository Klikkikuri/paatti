/**
 * @fileoverview Storage persistence and metadata management for Rahti database operations.
 * Synchronizes merged datasets to local storage, prunes obsolete entries, and updates timestamps.
 */

import browser from "../browser-api.js";
import { getLogger } from "../utils.js";

const log = getLogger("rahti:sync");

/**
 * Persists merged Rahti data to local storage and prunes obsolete keys.
 * 
 * @param {Object} rahtiStorage - Initialized Storage instance.
 * @param {Object} mergedData - Dictionary of merged Rahti entries.
 */
async function applyDataToStorage(rahtiStorage, mergedData) {
    const oldKeys = new Set(rahtiStorage.getKeys());
    log(`Merging fetched Rahti data... (${Object.keys(mergedData).length} new entries, old had ${oldKeys.size})`);

    await rahtiStorage.store(mergedData);

    const newKeys = new Set(Object.keys(mergedData));
    const keysToRemove = Array.from(oldKeys).filter(key => !newKeys.has(key));
    if (keysToRemove.length > 0) {
        log(`Removing ${keysToRemove.length} old entries not present in the new dataset.`);
        await rahtiStorage.remove(keysToRemove);
    }
}

/**
 * Saves update timestamp and header metadata to local storage.
 * 
 * @param {string|null} latestUpdated - Generation date string of latest payload.
 * @param {Object} rahtiHeaders - Previously cached headers per URL.
 * @param {Object[]} successfulResults - Results of successful HTTP fetches.
 * @param {string[]} urls - List of configured URLs.
 */
async function saveUpdateMetadata(latestUpdated, rahtiHeaders, successfulResults, urls) {
    for (const res of successfulResults) {
        if (res.status === 200) {
            rahtiHeaders[res.url] = {
                etag: res.etag || null,
                lastModified: res.lastModified || null,
                updated: (res.data && res.data.updated) || null
            };
        }
    }

    // Determine latest overall generation timestamp
    let overallLatest = latestUpdated;
    for (const r of successfulResults) {
        const updated = r.data && r.data.updated;
        if (updated && (!overallLatest || new Date(updated) > new Date(overallLatest))) {
            overallLatest = updated;
        }
    }
    for (const url of urls) {
        const cachedUpdate = rahtiHeaders[url] && rahtiHeaders[url].updated;
        if (cachedUpdate && (!overallLatest || new Date(cachedUpdate) > new Date(overallLatest))) {
            overallLatest = cachedUpdate;
        }
    }

    try {
        const storageItems = { 
            lastDatabaseUpdate: Date.now(),
            rahtiHeaders: rahtiHeaders 
        };
        if (overallLatest) {
            storageItems.databaseGenerationDate = overallLatest;
        }
        await browser.storage.local.set(storageItems);
    } catch (e) {
        log("Failed to save database update timestamps and headers:", e);
    }
}

/**
 * Checks if local database storage was updated within the specified threshold in milliseconds.
 * 
 * @param {number} thresholdMs - Maximum age in milliseconds.
 * @returns {Promise<boolean>} True if database was updated within threshold.
 */
async function isDatabaseRecentlyUpdated(thresholdMs = 60000) {
    try {
        const stored = await browser.storage.local.get("lastDatabaseUpdate");
        if (stored.lastDatabaseUpdate) {
            const ageMs = Date.now() - stored.lastDatabaseUpdate;
            return ageMs < thresholdMs;
        }
    } catch (err) {
        log("Failed reading database update timestamp:", err);
    }
    return false;
}

export { applyDataToStorage, saveUpdateMetadata, isDatabaseRecentlyUpdated };
