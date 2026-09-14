"use strict";

import browser from "./browser-api.js";
import { getLogger } from "./utils.js";
import { getConfig, PROVIDER_KEY_PREFIX, BUNDLED_SITE_KEYS } from "./config.js";
import { initStorage } from "./storage.js";
import { fetchManifest, resolve } from "./provider.js";

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

/** "16 is generous" -- keeps the sync list far under its quota and bounds refreshProviders() too. */
const MAX_PROVIDERS = 16;

/** The local storage namespace one provider's resolved content lives in. Read too by config.js's own merge. */
function namespaceFor(url) {
    return `${PROVIDER_KEY_PREFIX}${url}`;
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
 * Remove a provider and drop everything it resolved to.
 *
 * Removes the namespace's two keys by their exact name rather than through `Storage.prune()`, which
 * matches by prefix: two provider URLs where one is a literal prefix of the other (a differing query
 * string, a `.json` vs `.json.bak` path) would otherwise make removing one also wipe the other's data.
 *
 * @param {string} url
 * @returns {Promise<Array>} The updated list.
 */
async function removeProvider(url) {
    const providers = await getProviders();
    const updated = providers.filter((provider) => provider.url !== url);
    await browser.storage.sync.set({ providers: updated });

    const ns = namespaceFor(url);
    await browser.storage.local.remove([ns, `${ns}_index`]);

    return updated;
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

/**
 * One provider's last resolved content, or the empty shape for one that has never resolved.
 *
 * @param {string} url
 * @returns {Promise<{siteConfigs: object, rahtiData: object, suolaRules: object|null, scope: Set<string>,
 *   rejected: Array, errors: Array, updated: number|null}>}
 */
async function getProviderData(url) {
    const storage = await initStorage(namespaceFor(url));
    return {
        siteConfigs: (await storage.get("siteConfigs")) || {},
        rahtiData: (await storage.get("rahtiData")) || {},
        suolaRules: (await storage.get("suolaRules")) || null,
        scope: new Set((await storage.get("scope")) || []),
        rejected: (await storage.get("rejected")) || [],
        errors: (await storage.get("errors")) || [],
        updated: await storage.get("updated")
    };
}

/**
 * Refresh one provider: fetch its manifest, resolve every resource, and persist the result. A manifest
 * that cannot be fetched at all leaves the previous resolved content in place -- a stale result, kept
 * and flagged, rather than a working provider going dark on one network blip.
 *
 * @param {string} url
 * @param {object} config - As returned by `getConfig()`.
 * @param {Set<string>} claimedSiteKeys - Keys already claimed by the bundled set or an earlier provider.
 * @returns {Promise<{scope: Set<string>, error?: string}>}
 */
async function refreshOne(url, config, claimedSiteKeys) {
    const storage = await initStorage(namespaceFor(url));
    const { manifest, error } = await fetchManifest(url, config.loopbackProvidersEnabled);

    if (error) {
        log(`Manifest fetch failed for ${url}, keeping the last resolved content:`, error);
        await storage.set("errors", [{ message: error }]);
        return { scope: new Set((await storage.get("scope")) || []), error };
    }

    const result = await resolve(manifest, url, {
        loopbackProvidersEnabled: config.loopbackProvidersEnabled,
        providerShadowingEnabled: config.providerShadowingEnabled,
        claimedSiteKeys
    });

    await storage.store({
        siteConfigs: result.siteConfigs,
        rahtiData: result.rahtiData,
        suolaRules: result.suolaRules,
        scope: [...result.scope],
        rejected: result.rejected,
        errors: result.errors,
        updated: Date.now()
    });

    return { scope: result.scope };
}

/**
 * Refresh every enabled provider, in the order the user added them.
 *
 * Sequential, not parallel: each provider's declared scope becomes part of `claimedSiteKeys` for the
 * ones after it, which is what gives ties between two providers the "order the user added them in"
 * precedence the design calls for. The bundled set's own keys seed the claim before any provider runs,
 * so weight `0` still claims no precedence over it.
 *
 * @returns {Promise<Array<{url: string, scope: Set<string>, error?: string}>>}
 */
async function refreshProviders() {
    const config = await getConfig();
    const providers = await getProviders();
    // Bundled keys only -- getConfig().siteConfigs already folds every enabled provider's own
    // previously-resolved sites back in, which would make a provider look like it is shadowing its
    // own prior claim on every refresh after the first and never keep it.
    const claimedSiteKeys = new Set(BUNDLED_SITE_KEYS);

    const results = [];
    for (const provider of providers) {
        if (!provider.enabled) continue;

        const outcome = await refreshOne(provider.url, config, claimedSiteKeys);
        results.push({ url: provider.url, ...outcome });
        for (const key of outcome.scope) claimedSiteKeys.add(key);
    }

    return results;
}

export { MAX_PROVIDERS, getProviders, addProvider, removeProvider, setProviderEnabled, getProviderData, refreshProviders };
