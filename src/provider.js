"use strict";

import { getLogger, parseSemVer } from "./utils.js";
import { safeFetch, blockReason, readCapped, isLoopbackHost } from "./safe-fetch.js";
import { validRahtiData, rahtiToKeyed } from "./rahti/schema.js";

/**
 * Resolves a third-party provider manifest into the resources Paatti understands, and applies the
 * safety rules a manifest cannot be trusted to have applied itself.
 *
 * A manifest is a list of typed resources: `suola-rules`, `rahti-data`, `site-configs`, or an
 * `x-`/unknown type that is parsed and ignored. Every URL in it is a page's own choice to add, so it
 * goes through `safeFetch` like any other provider-influenced request, and is resolved in two phases
 * a caller must keep apart:
 *
 * - `inspect(manifestUrl)` -- gesture one. Fetches only the manifest, plus any *same-origin*
 *   `site-configs` document (already covered by the grant the manifest URL itself needed), and returns
 *   what a confirmation UI must disclose before the user commits: every resource origin the manifest
 *   names, and the sites a same-origin document already reveals.
 * - `resolve(manifest, manifestUrl)` -- gesture two, after the user has seen that disclosure and the
 *   resource origins are granted. Fetches every resource within the limits below, merges each type by
 *   its own rule, and returns the safety-filtered result.
 *
 * DOM-free and import-free of anything but `utils.js`, `safe-fetch.js` and `rahti/schema.js`, so it can
 * run under node as well as in the worker.
 */

const log = getLogger("provider");

/** The manifest and `sites.json` are `0.1.0`; the caret rule refuses a breaking `0.2.0` or `1.0.0`. */
const SUPPORTED_SCHEMA_VERSION = "0.1.0";

/** `type` -> the key its inline payload is carried under. Anything else parses as `UnknownResource`. */
const INLINE_KEYS = { "suola-rules": "rules", "rahti-data": "data", "site-configs": "sites" };

/** A manifest envelope is small; a resource document less so -- `data.json` is ~420 KB today. */
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

/** One hop, and a budget on both dimensions of it: how wide a manifest can be, and how much it can fetch. */
const MAX_RESOURCES = 32;
const MAX_FETCHES = 32;

/**
 * Whether `version` is compatible with `SUPPORTED_SCHEMA_VERSION` under the npm/Cargo caret rule: the
 * same major, and the same minor while the major is 0.
 *
 * @param {string} version
 * @returns {boolean}
 */
function caretCompatible(version) {
    const supported = parseSemVer(SUPPORTED_SCHEMA_VERSION);
    const incoming = parseSemVer(version);
    if (!supported || !incoming) return false;
    if (incoming.major !== supported.major) return false;
    if (supported.major === 0 && incoming.minor !== supported.minor) return false;
    return true;
}

/**
 * Why a provider-supplied `url` must not be requested, beyond what `blockReason` already refuses.
 *
 * `blockReason` only judges the address; a provider also needs the scheme rule `safeFetch`'s other
 * callers do not: remote targets must be HTTPS, and only a loopback address may use plain HTTP, and
 * only once the user has opted into reaching their own machine at all.
 *
 * @param {string} url
 * @param {boolean} loopbackProvidersEnabled
 * @returns {string|null}
 */
function providerBlockReason(url, loopbackProvidersEnabled) {
    const reason = blockReason(url, { allowLoopback: loopbackProvidersEnabled });
    if (reason) return reason;

    // Re-classifies the host through the same isLoopbackHost blockReason used above, rather than a
    // second definition of "loopback" -- the two calls cannot disagree.
    const parsed = new URL(url);
    const loopbackAllowed = loopbackProvidersEnabled && isLoopbackHost(parsed.hostname);
    if (parsed.protocol === "http:" && !loopbackAllowed) return "https required";
    return null;
}

/**
 * Fetch and JSON-parse one document, refusing it the same way `safeFetch` refuses any provider URL.
 *
 * Never throws: a failed document is data, not an exception, so the resource it belongs to can still
 * merge what did load.
 *
 * @param {string} url
 * @param {boolean} loopbackProvidersEnabled
 * @param {number} [maxBytes]
 * @returns {Promise<{content: object}|{error: string}>}
 */
async function fetchDocument(url, loopbackProvidersEnabled, maxBytes = MAX_RESOURCE_BYTES) {
    const reason = providerBlockReason(url, loopbackProvidersEnabled);
    if (reason) return { error: reason };

    try {
        const response = await safeFetch(url, { allowLoopback: loopbackProvidersEnabled });
        if (!response.ok) return { error: `HTTP ${response.status}` };

        const bytes = await readCapped(response, maxBytes);
        return { content: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch (err) {
        log(`Failed to fetch ${url}:`, err.message);
        return { error: err.message };
    }
}

/** `entry.href` as a list, whatever shape it arrived in. */
function hrefList(entry) {
    if (typeof entry.href === "string") return [entry.href];
    if (Array.isArray(entry.href)) return entry.href.filter((href) => typeof href === "string");
    return [];
}

/**
 * One `resources[]` entry, shape-checked but not fetched.
 *
 * @returns {object|null} null when the entry is malformed in a way the manifest cannot recover from.
 */
function parseResourceEnvelope(entry, index) {
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string") return null;

    const weight = Object.hasOwn(entry, "weight") ? entry.weight : 0;
    if (!Number.isInteger(weight) || weight < 0) return null;

    const known = Object.hasOwn(INLINE_KEYS, entry.type);
    const inlineKey = INLINE_KEYS[entry.type];
    const href = hrefList(entry);
    const inline = known && Object.hasOwn(entry, inlineKey) ? entry[inlineKey] : undefined;
    if (known && href.length === 0 && inline === undefined) return null;

    return {
        type: entry.type,
        known,
        href,
        inline,
        weight,
        origins: Array.isArray(entry.origins) ? entry.origins : undefined,
        description: typeof entry.description === "string" ? entry.description : undefined,
        index
    };
}

/**
 * Parse and shape-validate a manifest document. Does no I/O: every `href` stays a string.
 *
 * @param {object} raw
 * @returns {{manifest: object}|{error: string}}
 */
function parseManifest(raw) {
    if (!raw || typeof raw !== "object") return { error: "manifest is not an object" };
    if (!caretCompatible(raw.schema_version)) {
        return { error: `unsupported manifest schema_version ${JSON.stringify(raw.schema_version)}` };
    }
    if (!Array.isArray(raw.resources)) return { error: "manifest has no resources array" };
    if (raw.resources.length > MAX_RESOURCES) {
        return { error: `too many resources (${raw.resources.length} > ${MAX_RESOURCES})` };
    }

    const resources = [];
    for (const [index, entry] of raw.resources.entries()) {
        const resource = parseResourceEnvelope(entry, index);
        if (!resource) return { error: `resource ${index} is malformed` };
        resources.push(resource);
    }

    const links = Array.isArray(raw.links)
        ? raw.links.filter((link) => link && typeof link.rel === "string" && typeof link.href === "string")
        : [];

    return { manifest: { schemaVersion: raw.schema_version, name: raw.name, updated: raw.updated, links, resources } };
}

/** The known, non-ignored resources of a parsed manifest -- an unknown type is never fetched. */
function knownResources(manifest) {
    return manifest.resources.filter((resource) => resource.known);
}

/** `href` resolved against the manifest's own URL -- the only base a resource document ever gets. */
function resolveHref(manifestUrl, href) {
    return new URL(href, manifestUrl).href;
}

/** Whether every one of `resource`'s hrefs shares the manifest's own origin. True for a purely inline resource. */
function isSameOrigin(resource, manifestUrl, manifestOrigin) {
    return resource.href.every((href) => new URL(resolveHref(manifestUrl, href)).origin === manifestOrigin);
}

/**
 * Every origin a manifest's known resources name, whether or not fetching it needs a grant. A
 * confirmation UI discloses this whole set, per the plan: a CORS-open or already-granted host would
 * otherwise vanish from what the user is shown.
 *
 * @param {object} manifest
 * @param {string} manifestUrl
 * @returns {Set<string>}
 */
function resourceOrigins(manifest, manifestUrl) {
    const origins = new Set();
    for (const resource of knownResources(manifest)) {
        for (const href of resource.href) {
            try {
                origins.add(new URL(resolveHref(manifestUrl, href)).origin);
            } catch {
                // Reported against the resource when resolve() actually fetches it.
            }
        }
    }
    return origins;
}

/** A URL's scheme is `http:` or `https:`. Used to keep `javascript:`/`data:`/`mailto:` out of `links[]`. */
function isHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Whether every entry of `origins` is exactly `http(s)://<key>/*`.
 *
 * No Public Suffix List exists to tell a bare public suffix from a real one, so a host wildcard is
 * refused outright rather than partly trusted -- and the same exact-match rule is what stops a key
 * claiming an origin it does not name: `www.hs.fi` may not list `https://www.lapinkansa.fi/*`.
 *
 * @param {string} key
 * @param {string[]} origins
 * @returns {boolean}
 */
function originsMatchKey(key, origins) {
    if (!Array.isArray(origins) || origins.length === 0) return false;
    return origins.every((origin) => origin === `https://${key}/*` || origin === `http://${key}/*`);
}

/** The host an `https://host/*`-shaped origin pattern names, or null when it does not parse. */
function hostOf(origin) {
    try {
        return new URL(origin.replace(/\*$/, "")).hostname;
    } catch {
        return null;
    }
}

/** The hostnames named by a resource's declared `origins` (a cross-origin `site-configs` resource only). */
function coverageHostsOf(resource) {
    return new Set(resource.origins.map(hostOf));
}

/**
 * One `sites.json` site entry, kept only if it is shaped correctly and its declared origins are
 * exactly its own key -- the structural check every site must pass before it can be merged.
 *
 * @returns {{site: object}|{reason: string}}
 */
function validateSiteEntry(key, entry) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") {
        return { reason: "malformed site entry" };
    }

    const origins = Array.isArray(entry.origins) && entry.origins.length > 0
        ? entry.origins
        : [`https://${key}/*`];
    if (!originsMatchKey(key, origins)) return { reason: `origins do not match key ${key}` };

    const rules = Array.isArray(entry.rules) ? entry.rules : [];
    const links = Array.isArray(entry.links)
        ? entry.links.filter((link) => link && typeof link.rel === "string" && isHttpUrl(link.href))
        : [];

    return { site: { name: entry.name, enabled: entry.enabled !== false, origins, rules, links } };
}

/** Concatenate and dedupe two arrays of plain-object rules/origins/links, comparing by JSON shape. */
function concatDedupe(a, b) {
    const seen = new Set(a.map((item) => JSON.stringify(item)));
    const merged = a.slice();
    for (const item of b) {
        const key = JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
    }
    return merged;
}

/** Merge one incoming site into an accumulator entry: concatenate+dedupe the arrays, last-wins the rest. */
function mergeSite(existing, incoming) {
    if (!existing) return incoming;
    return {
        name: incoming.name,
        enabled: incoming.enabled,
        origins: concatDedupe(existing.origins, incoming.origins),
        rules: concatDedupe(existing.rules, incoming.rules),
        links: concatDedupe(existing.links, incoming.links)
    };
}

/**
 * Merge one fetched or inline `sites.json` document into `accumulator`. Returns a new accumulator;
 * never mutates its input.
 *
 * @param {object} accumulator - `{ [domain]: site }` merged so far.
 * @param {object} document - The `{ schema_version, sites }` document.
 * @param {object} options
 * @param {Set<string>|null} options.coverageHosts - The hosts a cross-origin resource declared; every
 *   site's own `origins` must resolve inside this set. Null for a same-origin or inline document, which
 *   needs no declaration and so has nothing to check coverage against.
 * @param {Set<string>} options.claimedSiteKeys - Keys already claimed by the bundled set or an earlier
 *   provider.
 * @param {boolean} options.providerShadowingEnabled
 * @returns {{siteConfigs: object, rejected: Array<{key: string|null, reason: string}>}}
 */
function mergeSiteConfigsDocument(accumulator, document, { coverageHosts, claimedSiteKeys, providerShadowingEnabled }) {
    if (!document || typeof document !== "object" || !caretCompatible(document.schema_version)) {
        return { siteConfigs: accumulator, rejected: [{ key: null, reason: "malformed or incompatible sites.json" }] };
    }

    const rejected = [];
    const merged = { ...accumulator };
    for (const [key, raw] of Object.entries(document.sites ?? {})) {
        const { site, reason } = validateSiteEntry(key, raw);
        if (!site) { rejected.push({ key, reason }); continue; }

        const covered = !coverageHosts || site.origins.every((origin) => coverageHosts.has(hostOf(origin)));
        if (!covered) {
            rejected.push({ key, reason: "site origin not covered by the resource's declared origins" });
            continue;
        }

        if (claimedSiteKeys.has(key) && !merged[key] && !providerShadowingEnabled) {
            rejected.push({ key, reason: "already claimed; shadowing is disabled" });
            continue;
        }

        merged[key] = mergeSite(merged[key], site);
    }

    return { siteConfigs: merged, rejected };
}

/**
 * The set of domain keys a provider's `site-configs` resources may speak for at query time -- the
 * scope the Suola and Rahti link-scoping rules consult. Bootstrapped from the merged sites themselves,
 * so it cannot be inflated by anything that is not already a real, well-formed key.
 *
 * @param {object} siteConfigs
 * @returns {Set<string>}
 */
function computeDeclaredScope(siteConfigs) {
    return new Set(Object.keys(siteConfigs));
}

/**
 * Gesture one: fetch only the manifest URL, plus any same-origin `site-configs` document, and report
 * what a confirmation UI must disclose before the user grants anything else.
 *
 * @param {string} manifestUrl
 * @param {object} [options]
 * @param {boolean} [options.loopbackProvidersEnabled]
 * @returns {Promise<{manifest: object, origins: Set<string>, sites: object, rejected: Array,
 *   ignoredCount: number}|{error: string}>}
 */
async function inspect(manifestUrl, { loopbackProvidersEnabled = false } = {}) {
    const reason = providerBlockReason(manifestUrl, loopbackProvidersEnabled);
    if (reason) return { error: `manifest URL refused: ${reason}` };

    const fetched = await fetchDocument(manifestUrl, loopbackProvidersEnabled, MAX_MANIFEST_BYTES);
    if (fetched.error) return { error: `manifest fetch failed: ${fetched.error}` };

    const { manifest, error } = parseManifest(fetched.content);
    if (error) return { error };

    const manifestOrigin = new URL(manifestUrl).origin;
    const origins = resourceOrigins(manifest, manifestUrl);
    const ignoredCount = manifest.resources.length - knownResources(manifest).length;

    let sites = {};
    const rejected = [];
    const mergeOptions = { coverageHosts: null, claimedSiteKeys: new Set(), providerShadowingEnabled: false };

    for (const resource of knownResources(manifest)) {
        if (resource.type !== "site-configs" || !isSameOrigin(resource, manifestUrl, manifestOrigin)) continue;

        for (const href of resource.href) {
            const doc = await fetchDocument(resolveHref(manifestUrl, href), loopbackProvidersEnabled);
            if (doc.error) { rejected.push({ key: null, reason: doc.error }); continue; }
            const result = mergeSiteConfigsDocument(sites, doc.content, mergeOptions);
            sites = result.siteConfigs;
            rejected.push(...result.rejected);
        }

        if (resource.inline !== undefined) {
            const document = { schema_version: SUPPORTED_SCHEMA_VERSION, sites: resource.inline };
            const result = mergeSiteConfigsDocument(sites, document, mergeOptions);
            sites = result.siteConfigs;
            rejected.push(...result.rejected);
        }
    }

    return { manifest, origins, sites, rejected, ignoredCount };
}

/**
 * Gesture two: fetch every known resource within the resolver limits, merge each type by its own rule,
 * and apply the safety filters. Only called after the origins `inspect()` reported are granted.
 *
 * @param {object} manifest - As returned by `inspect()`.
 * @param {string} manifestUrl
 * @param {object} [options]
 * @param {boolean} [options.loopbackProvidersEnabled]
 * @param {boolean} [options.providerShadowingEnabled]
 * @param {Set<string>} [options.claimedSiteKeys] - Site keys the bundled set or an earlier provider
 *   already claims. Shadowing decides whether this manifest may take one over.
 * @returns {Promise<{siteConfigs: object, rahtiData: object, suolaRules: object|null, scope: Set<string>,
 *   rejected: Array, errors: Array}>}
 */
async function resolve(manifest, manifestUrl, options = {}) {
    const {
        loopbackProvidersEnabled = false,
        providerShadowingEnabled = false,
        claimedSiteKeys = new Set()
    } = options;

    const manifestOrigin = new URL(manifestUrl).origin;
    const ordered = knownResources(manifest)
        .slice()
        .sort((a, b) => (a.weight - b.weight) || (a.index - b.index));

    const errors = [];
    const rejected = [];
    const visited = new Map();
    let fetchCount = 0;

    let siteConfigs = {};
    let rahtiData = {};
    let suolaSites = [];

    for (const resource of ordered) {
        const sameOrigin = isSameOrigin(resource, manifestUrl, manifestOrigin);

        if (resource.type === "site-configs") {
            const declared = Array.isArray(resource.origins) && resource.origins.length > 0;
            if (!sameOrigin && !declared) {
                rejected.push({ key: null, reason: "cross-origin resource declares no origins" });
                continue;
            }
            if (sameOrigin && resource.origins !== undefined) {
                rejected.push({ key: null, reason: "same-origin resource must not declare origins" });
                continue;
            }
        }

        const documents = [];
        for (const href of resource.href) {
            const absolute = resolveHref(manifestUrl, href);

            if (!visited.has(absolute)) {
                if (fetchCount >= MAX_FETCHES) {
                    errors.push({ type: resource.type, href: absolute, message: "fetch budget exhausted" });
                    continue;
                }
                fetchCount++;
                visited.set(absolute, await fetchDocument(absolute, loopbackProvidersEnabled));
            }

            const fetched = visited.get(absolute);
            if (fetched.error) errors.push({ type: resource.type, href: absolute, message: fetched.error });
            else documents.push(fetched.content);
        }

        if (resource.inline !== undefined) {
            documents.push(resource.type === "site-configs"
                ? { schema_version: SUPPORTED_SCHEMA_VERSION, sites: resource.inline }
                : resource.inline);
        }

        for (const content of documents) {
            if (resource.type === "suola-rules") {
                if (content && Array.isArray(content.sites)) suolaSites = suolaSites.concat(content.sites);
                else errors.push({ type: resource.type, message: "not a rules document (no sites[] array)" });
            } else if (resource.type === "rahti-data") {
                try {
                    if (validRahtiData(content)) rahtiData = { ...rahtiData, ...rahtiToKeyed(content) };
                    else errors.push({ type: resource.type, message: "not a rahti-data document" });
                } catch (err) {
                    errors.push({ type: resource.type, message: err.message });
                }
            } else if (resource.type === "site-configs") {
                const result = mergeSiteConfigsDocument(siteConfigs, content, {
                    coverageHosts: sameOrigin ? null : coverageHostsOf(resource),
                    claimedSiteKeys,
                    providerShadowingEnabled
                });
                siteConfigs = result.siteConfigs;
                rejected.push(...result.rejected);
            }
        }
    }

    return {
        siteConfigs,
        rahtiData,
        suolaRules: suolaSites.length > 0 ? { sites: suolaSites } : null,
        scope: computeDeclaredScope(siteConfigs),
        rejected,
        errors
    };
}

export {
    SUPPORTED_SCHEMA_VERSION,
    MAX_RESOURCES,
    MAX_FETCHES,
    caretCompatible,
    providerBlockReason,
    parseManifest,
    originsMatchKey,
    computeDeclaredScope,
    inspect,
    resolve
};
