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
 * True if `hostname` is one host. A `*` in a host can match many hosts, thus a `*` is not permitted.
 *
 * This is the rule for a site key and for the URL of a file. A site can also name its subdomains (see `isSiteHost`).
 */
export function isConcreteHost(hostname) {
    return hostname !== "" && !hostname.includes("*");
}

/**
 * True if `host` is one host, or the subdomains of one host (`*.hs.fi`) as a site origin may name them.
 *
 * The host after `*.` must have a dot, thus `*.fi` and `*` are refused. Paatti does not use the browser's Public
 * Suffix List (`publicSuffix`) to refuse `*.co.uk` as well:
 * - The API starts in Chrome 153 and Firefox 153, and Safari does not have it. The provider list is in sync storage,
 *   thus one provider could be correct on one device and refused on a different device.
 * - The browser asks the user before it grants the origin, and shows the origin in the question.
 */
export function isSiteHost(host) {
    if (!host.startsWith("*.")) return isConcreteHost(host);
    const base = host.slice(2);
    return base.includes(".") && isConcreteHost(base);
}

/**
 * Whether this build can add providers: only one that declares the wildcard can request a provider's origins.
 *
 * @param {{optional_host_permissions?: string[]}} manifest - `runtime.getManifest()`.
 * @returns {boolean}
 */
export function canAddProviders(manifest) {
    return Boolean(manifest.optional_host_permissions?.includes(ARBITRARY_ORIGINS));
}

/**
 * The match pattern for `url`: the scheme and the host, with all paths. The pattern has no port, because a pattern
 * without a port matches all ports.
 *
 * The pattern has no path, because a host permission ignores the path. Chrome's match-pattern reference says that the
 * path is "required but ignored". This extension shows it: the manifest asks for
 * `https://raw.githubusercontent.com/Klikkikuri/rahti/*`, and `permissions.contains` gives true for all other paths
 * on that host. If the pattern kept the path, the extension would ask for one thing, get a second thing, and show the
 * user a third thing. The user sees the third thing in the warning that lists the missing permissions.
 *
 * @param {string} url
 * @returns {string|null} Null if `url` is not an http(s) URL, or if its host is not one host.
 */
function originPattern(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!isConcreteHost(parsed.hostname)) return null;

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
 * The match patterns of the origins of a site, deduplicated, in first-seen order: the scheme and the host, with all
 * paths. Unlike `originPatterns`, it keeps `*.` before a host. An entry that is not an http(s) origin is skipped.
 *
 * @param {string[]} origins
 * @returns {string[]}
 */
export function sitePatterns(origins) {
    const patterns = origins.map((origin) => {
        const [, scheme, host] = origin.match(/^(https?):\/\/([^/]+)\//) || [];
        return host && isSiteHost(host) ? `${scheme}://${host}/*` : null;
    });
    return [...new Set(patterns.filter(Boolean))];
}

/**
 * True if this build can ask for all of `origins`. `permissions.request()` grants only an origin that the manifest
 * declares in `host_permissions` or `optional_host_permissions`. Thus, the answer comes from the manifest of the
 * build, not from the build type. The store build does not have the wildcard, thus it cannot grant a site that it does
 * not declare. The path is not compared, because a host permission ignores the path (see `originPattern`).
 *
 * @param {string[]} origins - Match patterns, such as `https://www.hs.fi/*`.
 * @param {{host_permissions?: string[], optional_host_permissions?: string[]}} manifest - `runtime.getManifest()`.
 * @returns {boolean} True if each origin has one host, or the subdomains of one host, and the manifest declares it.
 */
export function canRequestOrigins(origins, manifest) {
    const declared = [...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])]
        .map((pattern) => (pattern === "<all_urls>" ? "*://*/*" : pattern).match(/^(\*|https?):\/\/([^/]+)\//))
        .filter(Boolean);

    return origins.every((origin) => {
        const [, scheme, host] = origin.match(/^(https?):\/\/([^/]+)\//) || [];
        return Boolean(host) && isSiteHost(host) && declared.some(([, declaredScheme, declaredHost]) =>
            (declaredScheme === "*" || declaredScheme === scheme) &&
            (declaredHost === "*" || declaredHost === host ||
                (declaredHost.startsWith("*.") && (host === declaredHost.slice(2) || host.endsWith(declaredHost.slice(1))))));
    });
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
