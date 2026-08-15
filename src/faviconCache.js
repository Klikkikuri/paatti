"use strict";

/** Cache schema version. Increment if the entry format changes. */
const SCHEMA_VERSION = 1;

/** TTL for a successfully cached favicon: 30 days in milliseconds. */
export const FAVICON_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * TTL for a negatively-cached entry (fetch failed or returned non-2xx).
 * Shorter so sites that add a favicon are eventually picked up: 24 hours.
 */
export const FAVICON_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the browser.storage.local key for a given hostname.
 *
 * @param {string} domain - Hostname (e.g. "www.iltalehti.fi").
 * @returns {string} Storage key for the domain's favicon.
 */
export const getFaviconKey = (domain) => `favicon_${domain}`;

/**
 * Creates a versioned cache entry envelope.
 *
 * @param {string|null} data - Base64 data-URI, or null for a negative entry.
 * @returns {{ v: number, data: string|null, cachedAt: number }} Versioned envelope object.
 */
export const makeFaviconEntry = (data) => ({
    v: SCHEMA_VERSION,
    data,
    cachedAt: Date.now(),
});

/**
 * Determines whether a favicon cache entry has expired or is structurally invalid.
 * Treats entries from older schema versions as expired (lazy migration).
 *
 * @param {unknown} entry - The raw value retrieved from storage.
 * @returns {boolean} True if the entry should be treated as a cache miss.
 */
export const isFaviconExpired = (entry) => {
    if (!entry || typeof entry !== "object" || entry.v !== SCHEMA_VERSION) return true;
    if (typeof entry.cachedAt !== "number") return true;
    const ttl = entry.data === null ? FAVICON_NEGATIVE_TTL_MS : FAVICON_TTL_MS;
    return Date.now() - entry.cachedAt > ttl;
};
