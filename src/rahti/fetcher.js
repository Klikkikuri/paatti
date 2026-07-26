/**
 * @fileoverview HTTP network fetching and conditional caching for Rahti database endpoints.
 * Handles parallel HTTP requests, ETag/Last-Modified headers, and 304 status resolution.
 */

import { getLogger } from "../utils.js";

const log = getLogger("rahti:fetcher");

/**
 * Fetches data from a single Rahti URL, supporting conditional caching via ETag / Last-Modified.
 * 
 * @param {string} url - Target URL to fetch.
 * @param {Object} [urlHeaders] - Cached header metadata for this URL (etag/lastModified).
 * @param {boolean} [force=false] - If true, bypasses conditional caching.
 * @returns {Promise<Object>} Status object containing success flag, status code, data, etag, and lastModified.
 */
async function fetchSingleUrl(url, urlHeaders, force = false) {
    const fetchOpts = {
        referrerPolicy: "no-referrer",
        credentials: "omit"
    };
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
 * Fetches data from multiple Rahti URLs in parallel and resolves 304/200 HTTP statuses.
 * 
 * If some URLs returned 304 while others returned 200, unmodified URLs are re-fetched without
 * conditional headers to obtain complete payloads for merging.
 * 
 * @param {string[]} urls - Array of configured Rahti URLs.
 * @param {Object} rahtiHeaders - Previously cached headers per URL.
 * @param {boolean} [force=false] - Bypass conditional cache if true.
 * @returns {Promise<Object>} Object containing successfulResults array and boolean allNotModified flag.
 */
async function fetchAndResolvePayloads(urls, rahtiHeaders, force = false) {
    log(`Fetching Rahti data from ${urls.length} URL(s) in parallel...`);
    const fetchPromises = urls.map(url => fetchSingleUrl(url, rahtiHeaders[url], force));
    const results = await Promise.all(fetchPromises);

    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    log(`Fetched ${successfulResults.length} successful and ${failedResults.length} failed results.`);

    if (successfulResults.length === 0) {
        log("All attempts to fetch Rahti data failed.");
        if (failedResults.length > 0) {
            log(`Failed URLs: ${failedResults.map(r => r.url).join(', ')}`);
        }
        return { successfulResults: [], allNotModified: false };
    }

    // Check if database is completely unmodified across all URLs
    const allNotModified = successfulResults.every(r => r.status === 304) && failedResults.length === 0;
    if (allNotModified) {
        return { successfulResults, allNotModified: true };
    }

    // If some returned 304, but others returned 200, re-fetch 304s non-conditionally to merge full payloads
    for (let i = 0; i < successfulResults.length; i++) {
        const res = successfulResults[i];
        if (res.status === 304) {
            log(`Fetching full payload for unmodified URL to merge: ${res.url}`);
            const fullFetch = await fetchSingleUrl(res.url, null, true);
            if (!fullFetch.success) {
                log(`Failed to retrieve full payload for ${res.url}`);
                return { successfulResults: [], allNotModified: false };
            }
            successfulResults[i] = fullFetch;
        }
    }

    return { successfulResults, allNotModified: false };
}

export { fetchSingleUrl, fetchAndResolvePayloads };
