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
 * The match pattern that covers `url`: scheme and host, granted whole. No port either, since a pattern
 * without one matches every port.
 *
 * The path is left out because a host permission does not honour one. Chrome's match-pattern reference
 * says it is "required but ignored", and this extension demonstrates it: the manifest asks for
 * `https://raw.githubusercontent.com/Klikkikuri/rahti/*`, and `permissions.contains` answers true for any
 * other path on that host. Carrying the path over would ask for one thing, be granted a second, and show
 * the user a third -- and it is the third that reaches them, in the warning listing what is not granted.
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

    return `${parsed.protocol}//${parsed.hostname}/*`;
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
