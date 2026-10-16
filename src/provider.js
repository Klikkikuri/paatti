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
 * Conditional GET (D2, scoped to `rahti-data` resources -- see `resolve()`'s own doc comment for why
 * `site-configs`/`suola-rules` never pass a `cacheEntry` here): given a previously-seen `{etag,
 * lastModified}`, sends `If-None-Match`/`If-Modified-Since` and returns `{notModified: true}` on a 304
 * instead of parsing a body that was never sent.
 *
 * @param {string} url
 * @param {boolean} loopbackProvidersEnabled
 * @param {number} [maxBytes]
 * @param {object} [options]
 * @param {{etag?: string|null, lastModified?: string|null}} [options.cacheEntry]
 * @param {boolean} [options.force] - Bypass `cacheEntry` and fetch unconditionally.
 * @returns {Promise<{content: object, etag: string|null, lastModified: string|null}|{notModified: true}|{error: string}>}
 */
async function fetchDocument(url, loopbackProvidersEnabled, maxBytes = MAX_RESOURCE_BYTES, { cacheEntry, force = false } = {}) {
    const reason = providerBlockReason(url, loopbackProvidersEnabled);
    if (reason) return { error: reason };

    const headers = {};
    if (cacheEntry && !force) {
        if (cacheEntry.etag) headers["If-None-Match"] = cacheEntry.etag;
        if (cacheEntry.lastModified) headers["If-Modified-Since"] = cacheEntry.lastModified;
    }

    try {
        const response = await safeFetch(url, {
            allowLoopback: loopbackProvidersEnabled,
            ...(Object.keys(headers).length > 0 ? { init: { headers } } : {})
        });
        if (response.status === 304) return { notModified: true };
        if (!response.ok) return { error: `HTTP ${response.status}` };

        const bytes = await readCapped(response, maxBytes);
        return {
            content: JSON.parse(new TextDecoder().decode(bytes)),
            etag: response.headers.get("ETag") || null,
            lastModified: response.headers.get("Last-Modified") || null
        };
    } catch (err) {
        log(`Failed to fetch ${url}:`, err.message);
        return { error: err.message };
    }
}

/** `entry.href` as a list, whatever shape it arrived in. */
function hrefList(entry) {
    if (typeof entry.href === "string") return entry.href === "" ? [] : [entry.href];
    if (Array.isArray(entry.href)) return entry.href.filter((href) => typeof href === "string" && href !== "");
    return [];
}

/**
 * One `resources[]` entry, shape-checked but not fetched.
 *
 * @returns {object|null} null when the entry is malformed in a way the manifest cannot recover from.
 */
function parseResourceEnvelope(entry) {
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
        description: typeof entry.description === "string" ? entry.description : undefined
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
        const resource = parseResourceEnvelope(entry);
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

/**
 * `href` resolved against the manifest's own URL -- the only base a resource document ever gets. Null
 * rather than a throw: a provider's `href` is untrusted content, and a resource with one malformed
 * entry must be isolated like any other failure, not crash the whole resolution.
 */
function resolveHref(manifestUrl, href) {
    try {
        return new URL(href, manifestUrl).href;
    } catch {
        return null;
    }
}

/**
 * Whether every one of `resource`'s hrefs resolves and shares the manifest's own origin. True for a
 * purely inline resource; false (not a throw) the moment one href is malformed, which then falls to
 * the cross-origin path and is refused or reported there rather than here.
 */
function isSameOrigin(resource, manifestUrl, manifestOrigin) {
    return resource.href.every((href) => {
        const absolute = resolveHref(manifestUrl, href);
        return absolute !== null && new URL(absolute).origin === manifestOrigin;
    });
}

/**
 * Why a `site-configs` resource's `origins` are wrong for where it lives, or null. A cross-origin document must
 * declare the origins it may contribute; a same-origin one is read before the grant, so it must not.
 *
 * @param {object} resource
 * @param {boolean} sameOrigin - From isSameOrigin().
 * @returns {string|null}
 */
function originsDeclarationError(resource, sameOrigin) {
    const declared = Array.isArray(resource.origins) && resource.origins.length > 0;
    if (!sameOrigin && !declared) return "cross-origin resource declares no origins";
    if (sameOrigin && resource.origins !== undefined) return "same-origin resource must not declare origins";
    return null;
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
            const absolute = resolveHref(manifestUrl, href);
            // A malformed href contributes no origin; resolve() reports it against the resource instead.
            if (absolute) origins.add(new URL(absolute).origin);
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
 * Whether `key` is exactly a bare hostname -- no scheme, path, port or credentials. Load-bearing for
 * the declared-scope/shadowing gate: that gate compares `key` as a literal string, but a host is looked
 * up later by `matchesOrigin`, which reads only the authority up to the first `/` and so ignores any
 * path a key was allowed to carry. Without this check, a provider could claim `www.hs.fi/x` -- a
 * string `claimedSiteKeys` has never seen, so the shadowing gate never fires -- whose default origin
 * `https://www.hs.fi/x/*` still matches the real `www.hs.fi` at lookup time, taking over an
 * already-claimed host while the check meant to gate exactly that never ran.
 *
 * A key must round-trip unchanged through hostname parsing: `new URL("https://KEY/").hostname === KEY`
 * fails for anything that is not already a bare, lowercase, portless host.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isBareHostname(key) {
    if (typeof key !== "string" || key === "") return false;
    try {
        return new URL(`https://${key}/`).hostname === key;
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
    if (!isBareHostname(key)) return { reason: `site key is not a bare hostname: ${key}` };
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
 * Fetch and parse the manifest itself -- the one step every caller needs, whether it goes on to
 * disclose same-origin sites (`inspect`) or fetch every resource (a refresh cycle that already holds
 * the grants `inspect` was for).
 *
 * @param {string} manifestUrl
 * @param {boolean} loopbackProvidersEnabled
 * @returns {Promise<{manifest: object}|{error: string}>}
 */
async function fetchManifest(manifestUrl, loopbackProvidersEnabled) {
    const reason = providerBlockReason(manifestUrl, loopbackProvidersEnabled);
    if (reason) return { error: `manifest URL refused: ${reason}` };

    const fetched = await fetchDocument(manifestUrl, loopbackProvidersEnabled, MAX_MANIFEST_BYTES);
    if (fetched.error) return { error: `manifest fetch failed: ${fetched.error}` };

    return parseManifest(fetched.content);
}

/**
 * Gesture one: fetch only the manifest URL, plus any same-origin `site-configs` document, and report
 * what a confirmation UI must disclose before the user grants anything else.
 *
 * The shape-level checks resolve() also applies to a same-origin resource (origins declared where it
 * must not be, a malformed site, a host mismatch) are applied here too, so what this discloses can
 * never be less strict than the resolution that follows it. The declared-scope/shadowing check is the
 * one exception: it depends on state resolve() reads fresh at its own call time (the bundled set plus
 * every other currently-resolved provider), so it only matches resolve()'s outcome when the caller
 * passes the same `claimedSiteKeys`/`providerShadowingEnabled` resolve() will be called with -- with
 * the defaults below, a site already claimed elsewhere is disclosed here but may still be rejected then.
 *
 * @param {string} manifestUrl
 * @param {object} [options]
 * @param {boolean} [options.loopbackProvidersEnabled]
 * @param {boolean} [options.providerShadowingEnabled]
 * @param {Set<string>} [options.claimedSiteKeys] - See `resolve()`.
 * @returns {Promise<{manifest: object, origins: Set<string>, sites: object, rejected: Array,
 *   ignoredCount: number}|{error: string}>}
 */
async function inspect(manifestUrl, options = {}) {
    const { loopbackProvidersEnabled = false, providerShadowingEnabled = false, claimedSiteKeys = new Set() } = options;
    const { manifest, error } = await fetchManifest(manifestUrl, loopbackProvidersEnabled);
    if (error) return { error };

    const manifestOrigin = new URL(manifestUrl).origin;
    const origins = resourceOrigins(manifest, manifestUrl);
    const ignoredCount = manifest.resources.length - knownResources(manifest).length;

    let sites = {};
    const rejected = [];
    const mergeOptions = { coverageHosts: null, claimedSiteKeys, providerShadowingEnabled };

    for (const resource of knownResources(manifest)) {
        if (resource.type !== "site-configs" || !isSameOrigin(resource, manifestUrl, manifestOrigin)) continue;

        // The same rule as in resolve(), so a resource this preview shows is never one resolve() would go on
        // to reject outright -- the disclosure and the outcome must agree.
        const originsError = originsDeclarationError(resource, true);
        if (originsError) {
            rejected.push({ key: null, reason: originsError });
            continue;
        }

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
 * Conditional GET (D2) applies to `rahti-data` resources only, never to `site-configs`/`suola-rules`.
 * `mergeSiteConfigsDocument()` depends on `claimedSiteKeys`, which the caller rebuilds fresh on every
 * refresh pass -- reusing a cached `site-configs` merge result on a 304 would skip re-running the
 * shadowing/coverage check against a `claimedSiteKeys` that may have changed since, silently freezing a
 * stale accept/reject decision. `rahti-data` merging has no such external dependency (a pure function of
 * the fetched bytes), so caching it is safe.
 *
 * @param {object} manifest - As returned by `inspect()`.
 * @param {string} manifestUrl
 * @param {object} [options]
 * @param {boolean} [options.loopbackProvidersEnabled]
 * @param {boolean} [options.providerShadowingEnabled]
 * @param {Set<string>} [options.claimedSiteKeys] - Site keys the bundled set or an earlier provider
 *   already claims. Shadowing decides whether this manifest may take one over.
 * @param {Object<string, {etag?: string|null, lastModified?: string|null}>} [options.resourceHeaders] -
 *   Previously-seen conditional-GET headers, keyed by `rahti-data` href, from the provider's last resolve.
 * @param {object} [options.previousRahtiData] - The provider's last-resolved `rahtiData`, reused verbatim
 *   when every `rahti-data` href comes back 304.
 * @param {string|null} [options.previousDatabaseGenerationDate] - The provider's last-computed
 *   `databaseGenerationDate`, reused alongside `previousRahtiData` on an all-304 refresh -- otherwise a
 *   refresh where nothing changed would report no generation date at all instead of the real one.
 * @param {boolean} [options.force] - Bypass `resourceHeaders` and fetch every `rahti-data` href in full.
 * @returns {Promise<{siteConfigs: object, rahtiData: object, suolaRules: object|null, scope: Set<string>,
 *   rejected: Array, errors: Array, resourceHeaders: object, databaseGenerationDate: string|null}>}
 */
async function resolve(manifest, manifestUrl, options = {}) {
    const {
        loopbackProvidersEnabled = false,
        providerShadowingEnabled = false,
        claimedSiteKeys = new Set(),
        resourceHeaders = {},
        previousRahtiData = {},
        previousDatabaseGenerationDate = null,
        force = false
    } = options;

    const manifestOrigin = new URL(manifestUrl).origin;
    // .sort() has been a stable sort since ES2019, so this alone preserves document order for equal
    // weights -- knownResources() filters out of manifest.resources without reordering.
    const ordered = knownResources(manifest).slice().sort((a, b) => a.weight - b.weight);

    const errors = [];
    const rejected = [];

    // Phase 1: plan. Resource-level checks that need no fetched content run here, and every href that
    // will actually be requested is collected up front -- deduped and capped at MAX_FETCHES -- so phase
    // 2 can fetch them all at once instead of paying each one's latency back-to-back.
    const toFetch = [];
    const budgeted = new Set();
    const plans = [];
    const rahtiDataHrefs = new Set();

    for (const resource of ordered) {
        const sameOrigin = isSameOrigin(resource, manifestUrl, manifestOrigin);

        const originsError = resource.type === "site-configs" ? originsDeclarationError(resource, sameOrigin) : null;
        if (originsError) {
            rejected.push({ key: null, reason: originsError });
            continue;
        }

        const absoluteHrefs = [];
        for (const href of resource.href) {
            const absolute = resolveHref(manifestUrl, href);
            if (!absolute) {
                errors.push({ type: resource.type, href, message: "malformed href" });
                continue;
            }
            absoluteHrefs.push(absolute);
            if (resource.type === "rahti-data") rahtiDataHrefs.add(absolute);

            if (budgeted.has(absolute)) continue;
            if (toFetch.length >= MAX_FETCHES) continue; // stays unbudgeted; reported once fetches resolve
            budgeted.add(absolute);
            toFetch.push(absolute);
        }

        plans.push({ resource, sameOrigin, absoluteHrefs });
    }

    // Phase 2: fetch the plan, concurrently. Only rahti-data hrefs ever receive a cacheEntry -- see the
    // doc comment above for why site-configs/suola-rules always fetch in full. Promise.all preserves
    // toFetch's order in its result, but phase 3 reads through the map below by URL, so the actual
    // arrival order never matters.
    const fetched = new Map(
        await Promise.all(toFetch.map(async (url) => {
            const cacheEntry = rahtiDataHrefs.has(url) ? resourceHeaders[url] : undefined;
            return [url, await fetchDocument(url, loopbackProvidersEnabled, undefined, { cacheEntry, force })];
        }))
    );

    // If every rahti-data href came back 304, nothing changed: reuse the provider's last-resolved
    // rahtiData wholesale and carry its headers forward, rather than re-fetching content nobody asked to
    // see again. Otherwise, any rahti-data href that came back 304 is re-fetched in full (unconditionally)
    // so it still contributes real content to the merge below -- a mixed batch cannot merge "some cached,
    // some fresh" without the cached ones' bytes.
    const budgetedRahtiDataHrefs = [...rahtiDataHrefs].filter((href) => budgeted.has(href));
    const allRahtiDataNotModified = budgetedRahtiDataHrefs.length > 0
        && budgetedRahtiDataHrefs.every((href) => fetched.get(href)?.notModified);

    if (!allRahtiDataNotModified) {
        for (const href of budgetedRahtiDataHrefs) {
            if (fetched.get(href)?.notModified) {
                fetched.set(href, await fetchDocument(href, loopbackProvidersEnabled, undefined, { force: true }));
            }
        }
    }

    // Phase 3: merge, in the same (weight, document order) the plan was built in.
    let siteConfigs = {};
    let rahtiData = allRahtiDataNotModified ? previousRahtiData : {};
    let suolaSites = [];
    const newResourceHeaders = {};
    let databaseGenerationDate = allRahtiDataNotModified ? previousDatabaseGenerationDate : null;

    if (allRahtiDataNotModified) {
        for (const href of budgetedRahtiDataHrefs) newResourceHeaders[href] = resourceHeaders[href];
    }

    for (const { resource, sameOrigin, absoluteHrefs } of plans) {
        if (resource.type === "rahti-data" && allRahtiDataNotModified) continue; // already reused above

        const documents = [];
        for (const absolute of absoluteHrefs) {
            if (!budgeted.has(absolute)) {
                errors.push({ type: resource.type, href: absolute, message: "fetch budget exhausted" });
                continue;
            }
            const result = fetched.get(absolute);
            if (result.error) {
                errors.push({ type: resource.type, href: absolute, message: result.error });
                continue;
            }
            documents.push(result.content);
            if (resource.type === "rahti-data" && (result.etag || result.lastModified)) {
                newResourceHeaders[absolute] = { etag: result.etag || null, lastModified: result.lastModified || null };
            }
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
                    if (validRahtiData(content)) {
                        rahtiData = { ...rahtiData, ...rahtiToKeyed(content) };
                        if (content.updated && (!databaseGenerationDate || new Date(content.updated) > new Date(databaseGenerationDate))) {
                            databaseGenerationDate = content.updated;
                        }
                    } else {
                        errors.push({ type: resource.type, message: "not a rahti-data document" });
                    }
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
        errors,
        resourceHeaders: newResourceHeaders,
        databaseGenerationDate
    };
}

export {
    SUPPORTED_SCHEMA_VERSION,
    MAX_RESOURCES,
    MAX_FETCHES,
    caretCompatible,
    providerBlockReason,
    parseManifest,
    fetchManifest,
    originsMatchKey,
    computeDeclaredScope,
    resourceOrigins,
    inspect,
    resolve
};
