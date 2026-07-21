import { getLogger, browser, parseSemVer } from "./utils.js";
import { getConfig } from "./config.js";
import { initStorage } from "./storage.js";

// The supported schema version for the Rahti data format. This is used to ensure compatibility between the extension and the fetched data.
// Major version changes indicate breaking changes, while minor and patch versions are backward compatible.
const SUPPORTED_SCHEMA_VERSION = "0.1.0";

const log = getLogger("rahti");

let rahtiStorage = initStorage("rahtiData");

function rahtiToKeyed(rahti) {
    const mapped = {};

    if (!rahti || !rahti.entries) {
        log("Invalid Rahti data structure:", rahti);
        return mapped;
    }
    
    for (const entry of rahti.entries) {
        if (!entry.urls || entry.urls.length === 0) {
            continue;
        }

        // Extract sign from each URL and create individual entries
        for (const urlEntry of entry.urls) {
            const sign = urlEntry.sign;
            if (!sign) {
                log(`URL entry missing sign: ${urlEntry}`);
                continue;
            }
            mapped[sign] = entry;
        }
    }

    return mapped;
}

function validRahtiData(data) {
    if (!data || typeof data !== "object") {
        log("Invalid Rahti payload type:", data);
        return false;
    }

    if (!Array.isArray(data.entries)) {
        log("Invalid Rahti payload: missing entries array.", data);
        return false;
    }

    const supported = parseSemVer(SUPPORTED_SCHEMA_VERSION);
    const incoming = parseSemVer(data.schema_version);

    if (!supported || !incoming) {
        log("Could not parse schema version.", { supported: SUPPORTED_SCHEMA_VERSION, incoming: data ? data.schema_version : undefined });
        return false;
    }

    // Semantic Versioning rules: major versions indicate breaking changes.
    // If the major version of the fetched data is different from the supported major version,
    // we consider the data incompatible and throw an error.
    if (incoming.major !== supported.major) {
        throw new Error(`The title data format is not compatible: major version of data is ${incoming.major} when expected ${supported.major}. Update Paatti or use some other compatible title data source in order to fix.`);
    }

    return true;
}

/**
 * Fetches data from a single Rahti URL, supporting conditional caching via ETag / Last-Modified.
 * 
 * @param {string} url - The target URL to fetch.
 * @param {Object} [urlHeaders] - Cached header metadata for this URL (etag/lastModified).
 * @param {boolean} [force=false] - If true, bypasses conditional caching.
 * @returns {Promise<Object>} An object indicating fetch success, status code, etag, lastModified, and parsed data.
 */
async function fetchSingleUrl(url, urlHeaders, force = false) {
    const fetchOpts = {};
    if (force) {
        fetchOpts.cache = "no-cache";
    }

    const headers = {};
    if (!force && urlHeaders) {
        if (urlHeaders.etag) {
            headers["If-None-Match"] = urlHeaders.etag;
        }
        if (urlHeaders.lastModified) {
            headers["If-Modified-Since"] = urlHeaders.lastModified;
        }
    }

    if (Object.keys(headers).length > 0) {
        fetchOpts.headers = headers;
    }

    try {
        const response = await fetch(url, fetchOpts);
        if (response.status === 304) {
            return { success: true, status: 304, url };
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const etag = response.headers.get("ETag");
        const lastModified = response.headers.get("Last-Modified");
        const data = await response.json();
        
        return { 
            success: data.status === "ok", 
            status: 200, 
            url, 
            data, 
            etag, 
            lastModified 
        };
    } catch (error) {
        log(`Failed to fetch from ${url}:`, error.message);
        return { success: false, url, error: error.message };
    }
}

/**
 * Saves metadata about the database update to local storage.
 * 
 * @param {string|null} latestUpdated - The latest database generation date.
 * @param {Object} rahtiHeaders - Dictionary of cached header metadata.
 * @param {Object[]} successfulResults - Results of successful fetches to extract new headers from.
 */
async function saveUpdateMetadata(latestUpdated, rahtiHeaders, successfulResults) {
    for (const res of successfulResults) {
        if (res.status === 200) {
            rahtiHeaders[res.url] = {
                etag: res.etag || null,
                lastModified: res.lastModified || null,
                updated: res.data && res.data.updated || null
            };
        }
    }

    try {
        const storageItems = { 
            lastDatabaseUpdate: Date.now(),
            rahtiHeaders: rahtiHeaders 
        };
        if (latestUpdated) {
            storageItems.databaseGenerationDate = latestUpdated;
        }
        await browser().storage.local.set(storageItems);
    } catch (e) {
        log("Failed to save database update timestamps and headers:", e);
    }
}

/**
 * Asynchronously fetches Rahti title data from configured URLs in parallel.
 * 
 * Note on Caching: While browsers automatically handle If-None-Match/If-Modified-Since
 * at the network level and return a 200 response with cached data on a 304 hit,
 * doing so still forces our extension to parse the full JSON payload, merge the data,
 * and rewrite it to local storage on every check. By manually managing conditional headers
 * and intercepting the 304 status, we can skip these heavy CPU and I/O tasks entirely
 * when the server database hasn't changed, saving battery and disk longevity.
 * 
 * @param {Object} [options={}] - Options configuration.
 * @param {boolean} [options.force=false] - If true, bypasses the browser and conditional cache checks.
 * @returns {Promise<boolean>} True if retrieval/update succeeded (or verified unmodified), false otherwise.
 */
async function fetchRahtiData(options = {}) {
    log("Starting fetch of Rahti data...");
    const config = await getConfig();

    // Ensure rahtiStorage is initialized
    rahtiStorage = await rahtiStorage;

    const urls = config.titleDataUrls || [];
    log("Configured Rahti data URLs:", urls);
    if (urls.length === 0) {
        log("No URLs configured for fetching Rahti data.");
        return false;
    }

    // Retrieve previous headers cache
    let rahtiHeaders = {};
    try {
        const stored = await browser().storage.local.get("rahtiHeaders");
        rahtiHeaders = stored.rahtiHeaders || {};
    } catch (err) {
        log("Failed to load rahti headers from storage:", err);
    }

    log(`Fetching Rahti data from ${urls.length} URL(s) in parallel...`);
    const fetchPromises = urls.map(url => fetchSingleUrl(url, rahtiHeaders[url], options.force));
    const results = await Promise.all(fetchPromises);
 
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    log(`Fetched ${successfulResults.length} successful and ${failedResults.length} failed results.`);

    if (successfulResults.length === 0) {
        log("All attempts to fetch Rahti data failed.");
        if (failedResults.length > 0) {
            log(`Failed URLs: ${failedResults.map(r => r.url).join(', ')}`);
        }
        return false;
    }

    // If all successful results returned 304, and there are no failures, database is up to date
    const allNotModified = successfulResults.every(r => r.status === 304);
    if (allNotModified && failedResults.length === 0) {
        log("All URLs returned 304 Not Modified. Database is up to date.");
        try {
            await browser().storage.local.set({ lastDatabaseUpdate: Date.now() });
        } catch (e) {
            log("Failed to save database update timestamp:", e);
        }
        return true;
    }

    // If some returned 304, but others returned 200, we need to fetch the 304 payloads non-conditionally to merge
    for (let i = 0; i < successfulResults.length; i++) {
        const res = successfulResults[i];
        if (res.status === 304) {
            log(`Fetching full payload for unmodified URL to merge: ${res.url}`);
            const fullFetch = await fetchSingleUrl(res.url, null, true);
            if (!fullFetch.success) {
                log(`Failed to retrieve full payload for ${res.url}`);
                return false;
            }
            successfulResults[i] = fullFetch;
        }
    }

    // Now validate all fetched data
    for (const res of successfulResults) {
        if (!validRahtiData(res.data)) {
            return false;
        }
    }

    // Merge and store fetched data
    const oldKeys = new Set(rahtiStorage.getKeys());
    log("Merging fetched Rahti data...");
    const mergedData = successfulResults.reduce((acc, result) => {
        const keyedData = rahtiToKeyed(result.data);
        return { ...acc, ...keyedData };
    }, {});
    log(`Merged data contains ${Object.keys(mergedData).length} entries (old had ${oldKeys.size})`);

    await rahtiStorage.store(mergedData);

    // Prune old entries
    const newKeys = new Set(Object.keys(mergedData));
    const keysToRemove = Array.from(oldKeys).filter(key => !newKeys.has(key));
    log(`Removing ${keysToRemove.length} old entries not present in the new dataset.`);
    if (keysToRemove.length > 0) {
        await rahtiStorage.remove(keysToRemove);
    }
    
    // Determine latest updated generation timestamp
    let latestUpdated = null;
    for (const r of successfulResults) {
        const updated = r.data && r.data.updated;
        if (updated && (!latestUpdated || new Date(updated) > new Date(latestUpdated))) {
            latestUpdated = updated;
        }
    }
    for (const url of urls) {
        const cachedUpdate = rahtiHeaders[url] && rahtiHeaders[url].updated;
        if (cachedUpdate && (!latestUpdated || new Date(cachedUpdate) > new Date(latestUpdated))) {
            latestUpdated = cachedUpdate;
        }
    }

    await saveUpdateMetadata(latestUpdated, rahtiHeaders, successfulResults);
    return true;
}

export { fetchRahtiData, rahtiStorage };
