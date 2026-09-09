"use strict";

/**
 * @file origins.js
 * Which host permissions a list of URLs needs.
 *
 * DOM-free and import-free on purpose: tools/manifest.mjs reads the wildcard from here under node,
 * and `make test` covers the derivation without a browser.
 */

/** The optional host permission that lets a build request any http(s) origin. The store build drops it. */
export const ARBITRARY_ORIGINS = "*://*/*";

/**
 * The match pattern that covers `url`: scheme, host and path, with a trailing wildcard so a query string
 * still matches. No port: a pattern without one matches every port in both browsers.
 *
 * @param {string} url
 * @returns {string|null} Null for a string that is not an http(s) URL.
 */
function originPattern(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}*`;
}

/**
 * The patterns that cover `urls`, deduplicated, in first-seen order. Strings that are not http(s) URLs
 * are skipped; the save handler already validates them.
 *
 * @param {string[]} urls
 * @returns {string[]}
 */
export function originPatterns(urls) {
    return [...new Set(urls.map(originPattern).filter(Boolean))];
}

/**
 * The patterns among `urls` that the browser has not granted.
 *
 * @param {string[]} urls
 * @param {(pattern: string) => Promise<boolean>} contains - Usually `browser.permissions.contains` for one origin.
 * @returns {Promise<string[]>}
 */
export async function missingOrigins(urls, contains) {
    const missing = [];
    for (const pattern of originPatterns(urls)) {
        if (!(await contains(pattern))) missing.push(pattern);
    }

    return missing;
}
