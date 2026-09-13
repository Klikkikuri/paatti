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
 * How often a page may steer a request is bounded by the rate limit alone. The TTL and the in-flight
 * set do not help there: neither survives a refused fetch, which writes nothing.
 *
 * Tier one is `_favicon/` in the options page; this exists because Firefox has no such permission.
 */

const log = getLogger("favicon");

/** A favicon is small. Past this a response is not one, and base64 in storage.local inflates it by a third. */
export const MAX_FAVICON_BYTES = 64 * 1024;

/**
 * How many fetches this worker issues inside one window, counted across every domain.
 *
 * Every attempt counts, a failed one included. Nothing is cached when a fetch throws or the response
 * is refused, so a limit that admitted a domain once and then waved it through would bound nothing:
 * a page that reloads with a different URL each time never needs a second domain. A legitimate fetch
 * is rare next to this -- one per site per TTL, which is thirty days.
 */
export const MAX_FAVICON_FETCHES = 16;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Domains with a fetch in flight in this worker lifecycle. */
const pending = new Set();

/** When each fetch inside the current window was issued, oldest first. */
const issuedAt = [];

/** Whether another fetch fits inside the window, counting it when it does. */
function withinRateLimit() {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    while (issuedAt.length > 0 && issuedAt[0] < cutoff) issuedAt.shift();

    if (issuedAt.length >= MAX_FAVICON_FETCHES) return false;

    issuedAt.push(Date.now());
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

        if (!withinRateLimit()) {
            log(`Favicon fetch for ${domain} skipped: over ${MAX_FAVICON_FETCHES} fetches in the window.`);
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
