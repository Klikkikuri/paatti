"use strict";

import browser from "./browser-api.js";
import { getLogger } from "./utils.js";
import { safeFetch, readCapped } from "./safe-fetch.js";
import { getFaviconKey, makeFaviconEntry, isFaviconExpired } from "./faviconCache.js";

/**
 * The network tier of the favicon cache, which the worker owns because a content script cannot reach
 * a third-party origin.
 *
 * Every input here arrives in a message from a page, so none of it is trusted.
 *
 * A page picks the URL -- a `link[rel~="icon"]` anywhere in the document is enough, and
 * `http://192.168.1.1/api/shutdown` is as valid a `<link>` as any -- so the request goes through
 * `safeFetch`, which refuses every address a page could not reach on its own. It is not held to the
 * page's own origin: a favicon on a CDN is ordinary, and iltalehti.fi serves its only one that way.
 * What remains reachable is a credential-free GET to a public address whose response no one here can
 * read, which the page can already issue itself.
 *
 * The storage key is the exception, and comes from the sender rather than the message: a page may
 * write the favicon shown for its own host, and for no other.
 *
 * Tier one is `_favicon/` in the options page; this exists because Firefox has no such permission.
 */

const log = getLogger("favicon");

/** A favicon is small. Past this a response is not one, and base64 in storage.local inflates it by a third. */
export const MAX_FAVICON_BYTES = 64 * 1024;

/**
 * How many distinct domains this worker fetches for inside one window. Distinct domains are what a
 * page can still grow -- the TTL and the in-flight guard already stop one domain being fetched twice
 * -- and the count resets with the worker, as every other guard here does.
 */
export const MAX_FAVICON_DOMAINS = 16;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Domains with a fetch in flight in this worker lifecycle. */
const pending = new Set();

/** When each domain was last fetched, kept only for the length of the window. */
const fetchedAt = new Map();

/** Whether a fetch for `domain` fits inside the window, counting it when it does. */
function withinRateLimit(domain) {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [seen, at] of fetchedAt) {
        if (at < cutoff) fetchedAt.delete(seen);
    }

    if (fetchedAt.has(domain)) return true;
    if (fetchedAt.size >= MAX_FAVICON_DOMAINS) return false;

    fetchedAt.set(domain, Date.now());
    return true;
}

/**
 * Write one entry under `domain` and under its `www` sibling.
 *
 * The options page keys favicons by the domain in the site config, which can be the other spelling of
 * the host a page was served from. Both keys are the sender's own host either way.
 */
async function writeEntry(domain, entry) {
    const sibling = domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`;
    await browser.storage.local.set({
        [getFaviconKey(domain)]: entry,
        [getFaviconKey(sibling)]: entry
    });
}

/** Bytes as a data URI. Base64 by hand: `FileReader` does not exist in a service worker. */
function toDataUri(contentType, bytes) {
    let binary = "";
    const chunk = 8192;
    for (let index = 0; index < bytes.byteLength; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
}

/**
 * Fetch and cache the favicon a page offered, if every guard here allows it.
 *
 * Resolves rather than rejecting: the caller sends this message without waiting for it, and a favicon
 * is decoration. Everything that stopped the fetch is logged.
 *
 * @param {string|undefined} senderUrl - `sender.url`: the page the message came from, and the only
 *   source of the domain written. A message that claims a different one is ignored.
 * @param {string|undefined} faviconUrl - The URL the page offered. `safeFetch` judges it.
 * @returns {Promise<void>}
 */
export async function storeFavicon(senderUrl, faviconUrl) {
    let page;
    let favicon;
    try {
        page = new URL(senderUrl);
        favicon = new URL(faviconUrl);
    } catch {
        // No sender URL, so no domain this may be written under; or the page offered nothing usable.
        return;
    }

    const domain = page.hostname;
    if (pending.has(domain)) return;

    // Claimed before the first await, so two messages cannot both pass the check above.
    pending.add(domain);
    try {
        const stored = await browser.storage.local.get(getFaviconKey(domain));
        if (!isFaviconExpired(stored[getFaviconKey(domain)])) return;

        if (!withinRateLimit(domain)) {
            log(`Favicon fetch for ${domain} skipped: over ${MAX_FAVICON_DOMAINS} domains in the window.`);
            return;
        }

        const response = await safeFetch(favicon.href);
        if (!response.ok) {
            // Negatively cached, or every page load retries it.
            await writeEntry(domain, makeFaviconEntry(null));
            log(`Favicon fetch failed for ${domain} (HTTP ${response.status}), negatively cached.`);
            return;
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.startsWith("image/")) {
            await writeEntry(domain, makeFaviconEntry(null));
            log(`Favicon for ${domain} is ${contentType || "untyped"}, not an image; negatively cached.`);
            return;
        }

        // Past the cap this throws, so an oversized response is not stored. It is not negatively cached
        // either: the claimed length usually rejects it before a byte arrives, and the rate limit bounds
        // what a retry can cost.
        const bytes = await readCapped(response, MAX_FAVICON_BYTES);

        await writeEntry(domain, makeFaviconEntry(toDataUri(contentType, bytes)));
        log(`Favicon cached for ${domain}.`);
    } catch (err) {
        // A refused address or a transient network error. Not negatively cached: the next page load retries.
        log(`Favicon fetch error for ${domain}:`, err);
    } finally {
        pending.delete(domain);
    }
}
