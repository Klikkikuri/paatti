/**
 * @fileoverview Main facade module for Rahti title database operations.
 * Coordinates single-flight locks, retryable background updates, and storage initialization.
 */

import { getLogger, browser } from "./utils.js";
import { getConfig } from "./config.js";
import { initStorage } from "./storage.js";
import { validRahtiData, rahtiToKeyed } from "./rahti/schema.js";
import { fetchAndResolvePayloads } from "./rahti/fetcher.js";
import { applyDataToStorage, saveUpdateMetadata, isDatabaseRecentlyUpdated } from "./rahti/sync.js";

const log = getLogger("rahti");

let rahtiStorage = initStorage("rahtiData");
let activeFetchPromise = null;

/**
 * Core execution of Rahti data fetch across configured URLs.
 * 
 * @param {Object} [options={}] - Options configuration.
 * @param {boolean} [options.force=false] - If true, bypasses conditional caching.
 * @returns {Promise<boolean>} True if retrieval/update succeeded, false otherwise.
 */
async function _executeFetchRahtiData(options = {}) {
    log("Starting fetch of Rahti data...");
    const config = await getConfig();
    rahtiStorage = await rahtiStorage;

    const urls = config.titleDataUrls || [];
    log("Configured Rahti data URLs:", urls);
    if (urls.length === 0) {
        log("No URLs configured for fetching Rahti data.");
        return false;
    }

    let rahtiHeaders = {};
    try {
        const stored = await browser().storage.local.get("rahtiHeaders");
        rahtiHeaders = stored.rahtiHeaders || {};
    } catch (err) {
        log("Failed to load rahti headers from storage:", err);
    }

    const { successfulResults, allNotModified } = await fetchAndResolvePayloads(urls, rahtiHeaders, options.force);

    if (successfulResults.length === 0) {
        return false;
    }

    if (allNotModified) {
        log("All URLs returned 304 Not Modified. Database is up to date.");
        try {
            await browser().storage.local.set({ lastDatabaseUpdate: Date.now() });
        } catch (e) {
            log("Failed to save database update timestamp:", e);
        }
        return true;
    }

    for (const res of successfulResults) {
        if (!validRahtiData(res.data)) {
            return false;
        }
    }

    const mergedData = successfulResults.reduce((acc, result) => {
        const keyedData = rahtiToKeyed(result.data);
        return { ...acc, ...keyedData };
    }, {});

    await applyDataToStorage(rahtiStorage, mergedData);
    await saveUpdateMetadata(null, rahtiHeaders, successfulResults, urls);
    return true;
}

/**
 * Asynchronously fetches Rahti title data.
 * 
 * Locks in-flight requests to prevent concurrent fetch race conditions.
 * Concurrent non-forced callers join the active in-flight fetch promise.
 * 
 * @param {Object} [options={}] - Options configuration.
 * @param {boolean} [options.force=false] - If true, bypasses conditional caching.
 * @returns {Promise<boolean>} True if retrieval/update succeeded, false otherwise.
 */
async function fetchRahtiData(options = {}) {
    if (activeFetchPromise) {
        if (!options.force) {
            log("Fetch already in progress. Joining active in-flight fetch...");
            return activeFetchPromise;
        }
        log("Fetch already in progress, but force=true requested. Awaiting active fetch before forcing fresh fetch...");
        try {
            await activeFetchPromise;
        } catch (err) {
            // Ignore error from active fetch when executing forced fetch
        }
    }

    activeFetchPromise = (async () => {
        try {
            return await _executeFetchRahtiData(options);
        } finally {
            activeFetchPromise = null;
        }
    })();

    return activeFetchPromise;
}

/**
 * Wrapper around fetchRahtiData that provides retry capabilities for automatic background updates.
 * 
 * If a fetch attempt fails (e.g. temporary network offline state when machine wakes up from sleep),
 * it waits for a delay and retries up to maxRetries times. Aborts early if a manual or concurrent
 * fetch updates the database while sleeping between retry attempts.
 * 
 * @param {Object} [options={}] - Options passed to fetchRahtiData.
 * @param {Object} [retryConfig={}] - Configuration for retry attempts.
 * @param {number} [retryConfig.maxRetries=3] - Maximum retry attempts.
 * @param {number} [retryConfig.initialDelayMs=10000] - Initial delay in milliseconds before first retry (10s).
 * @param {number} [retryConfig.backoffFactor=2] - Delay multiplier for subsequent retries.
 * @returns {Promise<boolean>} True if retrieval/update succeeded, false if all attempts failed.
 */
async function fetchRahtiDataWithRetry(options = {}, retryConfig = {}) {
    const maxRetries = retryConfig.maxRetries ?? 3;
    const initialDelayMs = retryConfig.initialDelayMs ?? 10000;
    const backoffFactor = retryConfig.backoffFactor ?? 2;

    let attempt = 0;
    let delay = initialDelayMs;

    while (attempt <= maxRetries) {
        attempt++;
        try {
            const success = await fetchRahtiData(options);
            if (success) {
                if (attempt > 1) {
                    log(`Rahti data fetch succeeded on retry attempt ${attempt}.`);
                }
                return true;
            }
        } catch (err) {
            log(`Error during Rahti data fetch attempt ${attempt}/${maxRetries + 1}:`, err.message || err);
        }

        if (attempt <= maxRetries) {
            log(`Rahti data fetch attempt ${attempt} failed. Retrying in ${delay / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, delay));

            if (await isDatabaseRecentlyUpdated(60000)) {
                log("Database was updated concurrently during retry delay. Aborting remaining retries.");
                return true;
            }

            delay *= backoffFactor;
        }
    }

    log(`All ${maxRetries + 1} Rahti data fetch attempts failed.`);
    return false;
}

export { fetchRahtiData, fetchRahtiDataWithRetry, rahtiStorage };
