"use strict";

import browser from "./browser-api.js";
import { getLogger } from "./utils.js";
import { getConfig, isUsableProvider, PROVIDER_KEY_PREFIX, BUNDLED_SITE_KEYS } from "./config.js";
import { initStorage } from "./storage.js";
import { fetchManifest, resolve, resourceOrigins } from "./provider.js";
import { canRequestOrigins, missingOrigins, originPatterns } from "./options/origins.js";
import { SITE_CONFIGS } from "./generated/sites.js";
import { getFaviconKey } from "./faviconCache.js";

/**
 * The list of third-party providers the user added, and the resolved content each one currently
 * contributes.
 *
 * Two storage areas, because they hold different things: `providers` in sync is nothing but the
 * URLs, their order and whether each is enabled -- small enough for the 8 KB per-item sync quota, and
 * inert on a device where its permissions were never granted. Everything a provider actually resolved
 * to lives locally, in its own namespace keyed by its manifest URL -- a provider's identity, per the
 * design -- so a fetch failure or a removed provider only ever touches its own data.
 */

const log = getLogger("providers");

/** "17 is generous" -- keeps the sync list far under its quota and bounds refreshProviders() too. One
 *  more than before: the default provider now takes a slot in this same list (see config.js's
 *  defaultProviders / background.js's seedDefaultProviders()). */
const MAX_PROVIDERS = 17;

/** The local storage namespace one provider's resolved content lives in. Read too by config.js's own merge. */
function namespaceFor(url) {
    return `${PROVIDER_KEY_PREFIX}${url}`;
}

/**
 * The local storage key of one provider's document cache: the last good copy of each fetched file.
 *
 * A key of its own, not part of the namespace, so that the frequent readers of the namespace do not load it.
 */
function documentsKeyFor(url) {
    return `${namespaceFor(url)}_documents`;
}

/** The sync provider list: `{ url, enabled }` in the order the user added them. */
async function getProviders() {
    const { providers } = await browser.storage.sync.get("providers");
    return Array.isArray(providers) ? providers : [];
}

/**
 * Add a provider by its manifest URL. A no-op if it is already in the list.
 *
 * @param {string} url
 * @returns {Promise<Array>} The updated list.
 * @throws {Error} For an unparsable URL, or once `MAX_PROVIDERS` is already reached.
 */
async function addProvider(url) {
    new URL(url); // Throws on anything unparsable; providerBlockReason judges reachability later.

    const providers = await getProviders();
    if (providers.some((provider) => provider.url === url)) return providers;
    if (providers.length >= MAX_PROVIDERS) throw new Error(`At most ${MAX_PROVIDERS} providers are allowed.`);

    const updated = [...providers, { url, enabled: true }];
    await browser.storage.sync.set({ providers: updated });
    return updated;
}

/**
 * Remove a provider, drop everything it resolved to, and give back what only it used: the host permissions
 * for its servers and sites, and the favicons of its sites.
 *
 * Removes the provider's three keys by their exact name rather than through `Storage.prune()`, which
 * matches by prefix: two provider URLs where one is a literal prefix of the other (a differing query
 * string, a `.json` vs `.json.bak` path) would otherwise make removing one also wipe the other's data.
 *
 * @param {string} url
 * @returns {Promise<Array>} The updated list.
 */
async function removeProvider(url) {
    const removed = await getProviderData(url);
    const providers = await getProviders();
    const updated = providers.filter((provider) => provider.url !== url);
    await browser.storage.sync.set({ providers: updated });

    const ns = namespaceFor(url);
    await browser.storage.local.remove([ns, `${ns}_index`, documentsKeyFor(url)]);

    await releaseUnused(url, removed, updated.map((provider) => provider.url).filter(Boolean));

    return updated;
}

/** The `www.` and bare spellings of a host. favicon-fetch.js writes a favicon under both. */
function hostSpellings(domain) {
    return [domain, domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`];
}

/** Every site's origins, with the default getConfig() gives a site that declares none. */
function siteOrigins(siteConfigs) {
    return Object.entries(siteConfigs).flatMap(([domain, site]) => site.origins || [`https://${domain}/*`]);
}

/**
 * Revoke the host permissions and drop the favicons of a removed provider that nothing else uses. The bundled sites
 * and every provider still in the list keep theirs, a disabled one included, and an origin the manifest requires
 * cannot be revoked at all.
 */
async function releaseUnused(url, removed, remainingUrls) {
    const remaining = await Promise.all(remainingUrls.map(getProviderData));
    const keptSites = [SITE_CONFIGS, ...remaining.map((data) => data.siteConfigs)];
    const keptOrigins = new Set(originPatterns([
        ...remainingUrls,
        ...remaining.flatMap((data) => data.origins),
        ...keptSites.flatMap(siteOrigins)
    ]));

    const required = { host_permissions: browser.runtime.getManifest().host_permissions };
    const grantedForAccess = removed.errors.flatMap((error) => error.origins || []);
    const revoke = originPatterns([url, ...removed.origins, ...grantedForAccess, ...siteOrigins(removed.siteConfigs)])
        .filter((pattern) => !keptOrigins.has(pattern) && !canRequestOrigins([pattern], required));
    if (revoke.length > 0) await browser.permissions.remove({ origins: revoke });

    const keptHosts = new Set(keptSites.flatMap(Object.keys).flatMap(hostSpellings));
    const faviconKeys = Object.keys(removed.siteConfigs).flatMap(hostSpellings)
        .filter((host) => !keptHosts.has(host))
        .map(getFaviconKey);
    if (faviconKeys.length > 0) await browser.storage.local.remove(faviconKeys);
}

/**
 * Enable or disable a provider without forgetting it. A disabled provider keeps its last resolved
 * content in storage but is skipped by `refreshProviders()`.
 *
 * @param {string} url
 * @param {boolean} enabled
 * @returns {Promise<Array>} The updated list.
 */
async function setProviderEnabled(url, enabled) {
    const providers = await getProviders();
    const updated = providers.map((provider) => (provider.url === url ? { ...provider, enabled } : provider));
    await browser.storage.sync.set({ providers: updated });
    return updated;
}

/** The content of a provider that has never resolved. A function, so that no caller shares its objects. */
function emptyProviderData() {
    return {
        siteConfigs: {}, rahtiData: {}, suolaRules: null, scope: [], rejected: [], errors: [], updated: null,
        checked: null, entryCount: 0, databaseGenerationDate: null, origins: [], name: null, links: []
    };
}

/**
 * One provider's last resolved content, or the empty shape for one that has never resolved.
 *
 * @param {string} url
 * @returns {Promise<{siteConfigs: object, rahtiData: object, suolaRules: object|null, scope: Set<string>,
 *   rejected: Array, errors: Array, updated: number|null, checked: number|null, entryCount: number,
 *   databaseGenerationDate: string|null, origins: string[], name: string|null, links: Array}>} `updated` is the
 *   time of the last refresh with no fetch error, `checked` the time of the last attempt.
 */
async function getProviderData(url) {
    const storage = await initStorage(namespaceFor(url));
    const data = emptyProviderData();
    for (const key of Object.keys(data)) data[key] = (await storage.get(key)) ?? data[key];
    return { ...data, scope: new Set(data.scope) };
}

/**
 * Record why a refresh stopped, and keep the provider's last resolved content.
 *
 * @param {object} storage - The provider's namespace.
 * @param {string} url
 * @param {Array<{kind: string, message: string, href?: string, origins?: string[], transient?: boolean,
 *   retryAfterMs?: number}>} errors - `kind` is `build`, `access` or `fetch`. An `access` error also gives the
 *   `origins` to grant.
 * @returns {Promise<{scope: Set<string>, error: string, transient: boolean, retryAfterMs?: number}>}
 */
async function keepLastResolved(storage, url, errors) {
    const failure = failureOf(errors);
    log(`Refresh of ${url} stopped, keeping the last resolved content:`, failure.error);
    await storage.store({ errors, checked: Date.now() });
    return { scope: new Set((await storage.get("scope")) || []), ...failure };
}

/**
 * An error as text for the provider row: the message, after the href of the file when the error is about one.
 *
 * @param {{message: string, href?: string}} error - One of `getProviderData().errors`.
 * @returns {string}
 */
function errorText(error) {
    return error.href ? `${error.href}: ${error.message}` : error.message;
}

/**
 * The refresh result for `errors`: the text of the first failure, whether a retry can help, and the longest
 * `Retry-After`. An error with a `kind` is a failure. An error without one is about content.
 */
function failureOf(errors) {
    const failures = errors.filter((error) => error.kind);
    if (failures.length === 0) return {};
    const retryAfters = failures.map((error) => error.retryAfterMs).filter((ms) => ms !== undefined);
    return {
        error: errorText(failures[0]),
        transient: failures.some((error) => error.transient === true),
        ...(retryAfters.length > 0 && { retryAfterMs: Math.max(...retryAfters) })
    };
}

/** Whether `next` holds an entry that `cached` does not hold as the same object. */
function documentsChanged(cached, next) {
    if (!cached) return true;
    const hrefs = Object.keys(next);
    return hrefs.length !== Object.keys(cached).length || hrefs.some((href) => next[href] !== cached[href]);
}

/** An `access` error that names the origins this browser has not granted; null when every one is granted. */
async function accessError(urls) {
    const missing = await missingOrigins(urls, (pattern) => browser.permissions.contains({ origins: [pattern] }));
    return missing.length > 0 ? { kind: "access", message: `no access to ${missing.join(", ")}`, origins: missing } : null;
}

/**
 * Refresh one provider: fetch its manifest, resolve every resource, and persist the result. A manifest
 * that cannot be fetched leaves the previous resolved content in place -- a stale result, kept and
 * flagged, rather than a working provider going dark on one network blip. A resource file that fails
 * temporarily is merged from its cached copy (see `resolve()`).
 *
 * `updated` changes only on a refresh with no fetch error, so the status never shows a failed refresh
 * as a fresh one. `checked` changes on every attempt.
 *
 * Nothing is requested from an origin this browser has not granted. Without a grant the browser still sends the
 * request and only hides the response, so a synced provider, or a manifest that names a new host after the user
 * confirmed it, would otherwise reach servers the user never agreed to on this device.
 *
 * @param {string} url
 * @param {object} config - As returned by `getConfig()`.
 * @param {Set<string>} claimedSiteKeys - Keys already claimed by the bundled set or an earlier provider.
 * @param {object} [options]
 * @param {boolean} [options.force] - Send no conditional request headers.
 * @returns {Promise<{scope: Set<string>, error?: string, transient?: boolean, retryAfterMs?: number}>}
 */
async function refreshOne(url, config, claimedSiteKeys, { force = false } = {}) {
    const storage = await initStorage(namespaceFor(url));

    if (!isUsableProvider(url, new Set(config.defaultProviders || []))) {
        return keepLastResolved(storage, url, [{
            kind: "build",
            message: browser.i18n.getMessage("providerNotUsableInBuild")
                || "This version of the extension has no permission to use this provider."
        }]);
    }

    const manifestAccessError = await accessError([url]);
    if (manifestAccessError) return keepLastResolved(storage, url, [manifestAccessError]);

    const { manifest, error, transient, retryAfterMs } = await fetchManifest(url, config.loopbackProvidersEnabled);
    if (error) return keepLastResolved(storage, url, [{ kind: "fetch", message: error, transient, retryAfterMs }]);

    // Before the resource check, so a provider still waiting for its resource grant already shows its name.
    await storage.store({ name: manifest.name ?? null, links: manifest.links });

    const origins = [...resourceOrigins(manifest, url)];
    const resourceAccessError = await accessError(origins);
    if (resourceAccessError) return keepLastResolved(storage, url, [resourceAccessError]);

    const documentsKey = documentsKeyFor(url);
    const { [documentsKey]: cachedDocuments } = await browser.storage.local.get(documentsKey);
    const result = await resolve(manifest, url, {
        loopbackProvidersEnabled: config.loopbackProvidersEnabled,
        providerShadowingEnabled: config.providerShadowingEnabled,
        claimedSiteKeys,
        documents: cachedDocuments || {},
        force
    });
    const failure = failureOf(result.errors);

    // Content resolved before the document cache existed has no copy of each file to fall back on.
    if (!cachedDocuments && failure.transient && await storage.get("updated")) {
        return keepLastResolved(storage, url, result.errors.filter((error) => error.kind));
    }

    // getConfig() hides these sites; this says why, once per fetch.
    const unrequestable = Object.entries(result.siteConfigs)
        .filter(([, site]) => !canRequestOrigins(site.origins, browser.runtime.getManifest()))
        .map(([key]) => key);
    if (unrequestable.length > 0) log(`${url}: this build cannot request the origins of these sites, so they are hidden:`, unrequestable);

    if (documentsChanged(cachedDocuments, result.documents)) {
        await browser.storage.local.set({ [documentsKey]: result.documents });
    }

    const checked = Date.now();
    await storage.store({
        siteConfigs: result.siteConfigs,
        rahtiData: result.rahtiData,
        suolaRules: result.suolaRules,
        scope: [...result.scope],
        rejected: result.rejected,
        errors: result.errors,
        ...(failure.error ? {} : { updated: checked }),
        checked,
        entryCount: Object.keys(result.rahtiData).length,
        databaseGenerationDate: result.databaseGenerationDate,
        // Every resource origin the provider has used, so removeProvider() can revoke one that it no longer names.
        origins: originPatterns([...((await storage.get("origins")) || []), ...origins])
    });
    // Conditional-GET headers from before the document cache, which now holds them.
    if (storage.getKeys().includes("resourceHeaders")) await storage.remove(["resourceHeaders"]);

    return { scope: result.scope, ...failure };
}

/**
 * Refresh every enabled provider, in the order the user added them.
 *
 * Sequential, not parallel: each provider's declared scope becomes part of `claimedSiteKeys` for the
 * ones after it, which is what gives ties between two providers the "order the user added them in"
 * precedence the design calls for. The bundled set's own keys seed the claim before any provider runs,
 * so weight `0` still claims no precedence over it -- except for a default provider, which publishes the
 * bundled set and so may replace it.
 *
 * Single-flight within this execution context, but a `force: true` call always gets its own pass rather
 * than joining an in-flight non-forced one (which would silently return non-bypassed, possibly-cached
 * results -- defeating the point of a forced refresh). It still never runs concurrently with another
 * pass: it waits for whatever is currently in flight to settle first, then starts fresh. The identity
 * check in the `.finally()` below matters here -- with `force` calls able to chain onto each other,
 * more than one promise can occupy `refreshInFlight` in sequence, and an *earlier* one's cleanup firing
 * after a *later* one has already taken over must not null out the later one's reference.
 *
 * This does not reach across contexts -- the background service worker and an open options page
 * each hold their own promise -- so a refresh started in one can still race one started in the
 * other; that is accepted as a rare, self-healing staleness rather than solved with a storage lock.
 *
 * @param {object} [options]
 * @param {boolean} [options.force] - Send no conditional request headers.
 * @returns {Promise<Array<{url: string, scope: Set<string>, error?: string, transient?: boolean,
 *   retryAfterMs?: number}>>}
 */
async function refreshProviders({ force = false } = {}) {
    if (refreshInFlight && !force) return refreshInFlight;

    // No `await` before this line: reading `refreshInFlight` and reassigning it is one synchronous
    // step, so however many calls (forced or not) arrive back-to-back, each sees the previous one's
    // own reassignment rather than racing it -- this is what makes concurrent force calls chain
    // instead of running _refreshProviders() in parallel over the same storage writes.
    const previous = refreshInFlight;
    const run = previous ? previous.catch(() => {}).then(() => _refreshProviders(force)) : _refreshProviders(force);
    refreshInFlight = run;
    run.finally(() => { if (refreshInFlight === run) refreshInFlight = null; });
    return run;
}

let refreshInFlight = null;

async function _refreshProviders(force = false) {
    const config = await getConfig();
    const providers = await getProviders();
    // Bundled keys only -- getConfig().siteConfigs already folds every enabled provider's own
    // previously-resolved sites back in, which would make a provider look like it is shadowing its
    // own prior claim on every refresh after the first and never keep it.
    // A default provider publishes the bundled set, so the bundled keys are not a claim against it; the
    // keys of the providers before it still are.
    const defaultProviders = new Set(config.defaultProviders || []);
    const providerClaims = new Set();

    const results = [];
    for (const provider of providers) {
        // Same validity check getConfig() applies to enabledProviders: a URL-less entry (a
        // partially-written sync record) must be skipped by both in the same way, not just one.
        if (!provider.enabled || !provider.url) continue;

        const claimedSiteKeys = defaultProviders.has(provider.url)
            ? new Set(providerClaims)
            : new Set([...BUNDLED_SITE_KEYS, ...providerClaims]);
        const outcome = await refreshOne(provider.url, config, claimedSiteKeys, { force });
        results.push({ url: provider.url, ...outcome });
        for (const key of outcome.scope) providerClaims.add(key);
    }

    return results;
}

/** A failed default provider gets this many refresh passes in total, the first one included. */
const MAX_REFRESH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 30 * 1000;

/**
 * How long to wait before the next refresh pass, or null for no retry.
 *
 * Only a temporary failure of a default provider gets a retry, so a third-party manifest cannot make every
 * provider refresh again. The wait starts at 30 s and doubles; a server's `Retry-After` can make it longer. The
 * periodic refresh handles a wait longer than its interval.
 *
 * @param {Array<{url: string, transient?: boolean, retryAfterMs?: number}>} results - From `refreshProviders()`.
 * @param {Set<string>} defaultUrls - The active environment's default provider URLs.
 * @param {number} attempt - The pass that gave `results`, from 1.
 * @param {number} intervalMs - The periodic refresh interval.
 * @returns {number|null}
 */
function retryDelayMs(results, defaultUrls, attempt, intervalMs) {
    const failed = results.filter((result) => defaultUrls.has(result.url) && result.transient);
    if (failed.length === 0 || attempt >= MAX_REFRESH_ATTEMPTS) return null;

    const retryAfterMs = Math.max(0, ...failed.map((result) => result.retryAfterMs ?? 0));
    if (retryAfterMs > intervalMs) return null;
    return Math.min(Math.max(RETRY_BACKOFF_MS * 2 ** (attempt - 1), retryAfterMs), intervalMs);
}

/**
 * Install each enabled provider's Suola rules as its own named set, keyed by its manifest URL, and drop
 * any currently-defined name that no longer belongs to one -- a removed provider, a disabled one, or
 * one whose latest resolve produced no rules at all.
 *
 * Named sets do not survive a service-worker restart, so the caller must run this again on every
 * `initSuola()` wake, after awaiting it: this assumes `defineRules`/`dropRules`/`listRules` already
 * exist on `globalThis` and does not load the WASM module itself, so it can be tested without it by
 * stubbing those three.
 *
 * Never throws: this runs ahead of every `hashUrls` request, and a provider-bookkeeping failure --
 * a transient storage error, a malformed entry -- must degrade only the provider it belongs to, not
 * block hashing a page that may not even reference a provider's site.
 *
 * Single-flight, for the same reason as `refreshProviders()`: this runs on every `hashUrls` request,
 * and two overlapping passes reading `listRules()` at different points could each act on a different
 * snapshot of what the other just defined or dropped.
 *
 * @returns {Promise<void>}
 */
async function reconcileSuolaRules() {
    if (reconcileInFlight) return reconcileInFlight;
    reconcileInFlight = _reconcileSuolaRules().finally(() => { reconcileInFlight = null; });
    return reconcileInFlight;
}

let reconcileInFlight = null;

async function _reconcileSuolaRules() {
    let providers;
    try {
        providers = (await getProviders()).filter((provider) => provider?.enabled && provider?.url);
    } catch (err) {
        log("Failed to read the provider list; leaving Suola rule sets as they are:", err);
        return;
    }

    const results = await Promise.all(providers.map(async (provider) => {
        try {
            const data = await getProviderData(provider.url);
            return { url: provider.url, suolaRules: data.suolaRules };
        } catch (err) {
            log(`Failed to read resolved data for ${provider.url}:`, err);
            return { url: provider.url, suolaRules: null };
        }
    }));

    const activeNames = new Set();
    for (const { url, suolaRules } of results) {
        if (!suolaRules) continue;

        try {
            const refused = globalThis.defineRules(url, JSON.stringify(suolaRules));
            if (refused) {
                log(`defineRules refused the rules for ${url}:`, refused);
                continue;
            }
            activeNames.add(url);
        } catch (err) {
            log(`defineRules threw for ${url}:`, err);
        }
    }

    let defined = [];
    try {
        defined = typeof globalThis.listRules === "function" ? globalThis.listRules() : [];
    } catch (err) {
        log("listRules threw; stale named sets may remain defined this cycle:", err);
    }

    for (const name of defined) {
        if (activeNames.has(name)) continue;
        try {
            globalThis.dropRules(name);
        } catch (err) {
            log(`dropRules failed for ${name}:`, err);
        }
    }
}

export {
    MAX_PROVIDERS, namespaceFor, getProviders, addProvider, removeProvider, setProviderEnabled,
    getProviderData, errorText, refreshProviders, retryDelayMs, reconcileSuolaRules
};
