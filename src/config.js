"use strict";

import browser from "./browser-api.js";
import { getLogger } from "./utils.js";
import { SITE_CONFIGS } from "./generated/sites.js";
import { canRequestOrigins, canAddProviders } from "./options/origins.js";

const log = getLogger("config");

/** The official Rahti dataset's provider manifest, published in the sibling Klikkikuri/rahti repo
 *  alongside its data.json -- not a paatti-owned resource, just the URL every environment's default
 *  provider list points at. */
const DEFAULT_RAHTI_MANIFEST_URL = "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/manifest.json";

const DEFAULT_ENV = {
    "refreshIntervalMinutes": 20,
    // Chance (0..1) that the easter egg artwork joins the page background on a given day.
    // The day either has it or does not, from a calendar of its own per install, so this
    // is how many days in a hundred carry a sighting. Tuned low on purpose: a sighting
    // should feel like luck, not decoration.
    "easterEggProbability": 0.05,
    "email": "",
    "feedbackServerUrl": "https://docs.google.com/forms/d/e/1FAIpQLSf_vo9tpXAjbP1JyhNlgRdPnpPD1K3w6aPfern_jZfJVcHtCw/formResponse",
    // Whether a provider may take over a site key or origin the bundled set or another provider
    // already claims, and whether one may be reached at a loopback address. Two independent powers,
    // neither implied by the environment -- see getConfig() for why they must stay local, not synced.
    "providerShadowingEnabled": false,
    "loopbackProvidersEnabled": false,
}

const DEFAULT_CONFIG = {
    // CONFIG: Configure extension to start enabled here.
    "enabled": true,
    "environment": "free",
    "modifiers": {
        "aiSlop": true,
        "video": false,
        "converted": false
    },

    // The sites come from Rahti's sites.json; see tools/sites.mjs.
    "siteConfigs": SITE_CONFIGS,

    "environmentConfigs": {
        "free": {
            ...DEFAULT_ENV,
            "defaultProviders": [DEFAULT_RAHTI_MANIFEST_URL],
        },
        "paid": {
            ...DEFAULT_ENV,
            "debugVisualsEnabled": false,
            "refreshIntervalMinutes": 10,
            "email": "",
            "defaultProviders": [DEFAULT_RAHTI_MANIFEST_URL],
        },
        "development": {
            ...DEFAULT_ENV,
            "debugVisualsEnabled": true,
            "refreshIntervalMinutes": 1,
            // On by default only here; loopbackProvidersEnabled is not, since reaching the user's
            // own machine is an orthogonal power nothing about "development" implies.
            "providerShadowingEnabled": true,
            "modifiers": {
                "video": true,
                "converted": true
            },
            "defaultProviders": [DEFAULT_RAHTI_MANIFEST_URL],
            // "feedbackServerUrl": "http://localhost:3000/api/v1/feedback",
        },
    },
    "statistics": {},
};

/**
 * The domain keys the bundled set alone claims -- refreshProviders() seeds its precedence check from
 * this, not from getConfig().siteConfigs. That merged view already folds every enabled provider's own
 * previously-resolved sites back in, so seeding from it would make a provider look like it is
 * shadowing its own prior claim on every refresh after the first.
 */
const BUNDLED_SITE_KEYS = new Set(Object.keys(DEFAULT_CONFIG.siteConfigs));

// The keys getConfig() reads below -- used both for the storage.sync.get() call itself and for cache
// invalidation, so the two can never drift out of step the way they once did. Everything else --
// statistics above all, which are written on every conversion batch -- leaves the cache alone.
const WATCHED_KEYS = {
    local: ["userPreferences"],
    sync: ["userSiteOverrides", "modifiers", "environmentConfigs", "clickbaitLevelWarningSeen", "providers"],
};

// Where a provider's resolved content lives in storage.local: provider:<manifest url>. The source of
// truth for the prefix: providers.js imports it from here rather than the other way around, since it
// already depends on this module for settings.
const PROVIDER_KEY_PREFIX = "provider:";

let cachedConfig = null;
let pendingConfigPromise = null;

/** Live subscriptions: { select, callback, shape }, where shape starts at NOTHING. */
const subscriptions = new Set();
/** Distinct from every JSON shape -- `undefined` included -- so the first publish always calls back. */
const NOTHING = Symbol("nothing");

// Registered on import, so it precedes every listener a module importing this one can add.
browser.storage.onChanged.addListener((changes, areaName) => {
    const watchedKeyChanged = WATCHED_KEYS[areaName]?.some((key) => key in changes);
    // A provider's own namespace isn't a fixed key name, so it can't sit in WATCHED_KEYS -- caught by
    // prefix instead, the same way its content is folded into siteConfigs below.
    const providerDataChanged = areaName === "local"
        && Object.keys(changes).some((key) => key.startsWith(PROVIDER_KEY_PREFIX));
    if (!watchedKeyChanged && !providerDataChanged) return;

    log("Watched key changed in", areaName, "- invalidating config cache.");
    cachedConfig = null;
    pendingConfigPromise = null;
    publish();
});

// Serialized: storage events arrive in bursts, and an earlier, slower read must not deliver
// its state after a newer one has already gone out.
let publishChain = Promise.resolve();

/** Re-read the config and call back the subscriptions whose selected value moved. */
function publish() {
    publishChain = publishChain.then(async () => {
        if (subscriptions.size === 0) return;

        const config = await getConfig();
        // Deleting from the live Set mid-loop is safe: an entry removed before the iterator
        // reaches it is skipped, so a callback may unsubscribe itself or a sibling. That stops
        // being true if this is ever changed to iterate a snapshot.
        for (const subscription of subscriptions) {
            // Selector and callback both guarded: one component that throws on unexpected data
            // must not stop the others from being told.
            try {
                const value = subscription.select(config);
                const shape = JSON.stringify(value);
                if (shape === subscription.shape) continue;

                subscription.shape = shape;
                subscription.callback(value);
            } catch (error) {
                console.error("A config subscriber failed:", error);
            }
        }
    }).catch((error) => {
        // The chain must never settle rejected, or every later publish is skipped.
        console.error("Failed to publish a config change:", error);
    });

    return publishChain;
}

/**
 * Watch one value derived from the merged config.
 *
 * Calls back once with the value in storage now -- asynchronously, so a caller that must paint
 * at once paints a placeholder first -- and then only when that value genuinely changes.
 *
 * The value is compared by its JSON shape, so select narrowly. `getConfig()` rebuilds the config
 * on every read, so a selector returning a whole sub-tree re-fires whenever anything inside it
 * moves; return a primitive or a flat tuple of them.
 *
 * @param {(config: Object) => *} select - Picks the value to watch out of the merged config.
 * @param {(value: *) => void} callback - Called with each new value.
 * @returns {Function} Unsubscribes when called.
 */
function onConfigValue(select, callback) {
    const subscription = { select, callback, shape: NOTHING };
    subscriptions.add(subscription);
    // Fires this subscription only: every other selected value compares equal.
    publish();

    return () => subscriptions.delete(subscription);
}

/**
 * Whether this build may use the provider at `url`. A build that cannot add providers uses only its default ones,
 * also when browser sync brings in a provider that was added in another browser.
 *
 * @param {string} url
 * @param {Set<string>} defaultProviders - The active environment's default provider URLs.
 * @returns {boolean}
 */
function isUsableProvider(url, defaultProviders) {
    return canAddProviders(browser.runtime.getManifest()) || defaultProviders.has(url);
}

/**
 * Gets the merged configuration for the current environment.
 */
async function getConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    if (pendingConfigPromise) {
        return pendingConfigPromise;
    }

    const currentPromise = (async () => {
        const [localData, syncData] = await Promise.all([
            browser.storage.local.get("userPreferences"),
            browser.storage.sync.get(WATCHED_KEYS.sync)
        ]);

        const userPreferences = localData.userPreferences || {};
        const syncOverrides = syncData.userSiteOverrides || {}; // Structure: { "yle.fi": false }
        const syncModifiers = syncData.modifiers || {};
        const syncEnvConfigs = syncData.environmentConfigs || {}; // Structure: { "free": { "easterEggProbability": 0.05 } }

        // Providers own only their URL, order and enabled flag here; what each one resolved to lives
        // in its own storage.local namespace and is read as one batched call below, not one per
        // provider. src/providers.js writes that shape; the config keeps it as `providerData`, so the
        // read side never loads a namespace again.
        const providers = Array.isArray(syncData.providers) ? syncData.providers : [];

        const activeEnv = userPreferences.environment || DEFAULT_CONFIG.environment || "free";

        // Merge environment configs to avoid overwriting defaults
        const mergedEnvConfigs = {};
        const environments = ["free", "paid", "development"];
        for (const env of environments) {
            // These two relax security, so they must be decided by the device they affect. Stripped
            // out of the synced layer before the spread below, so a value arriving through sync --
            // from a future change that syncs environmentConfigs wholesale, or a stale profile --
            // can never override the local choice, in either direction.
            const {
                providerShadowingEnabled: _ignoredShadow,
                loopbackProvidersEnabled: _ignoredLoopback,
                ...syncedEnv
            } = syncEnvConfigs[env] || {};

            mergedEnvConfigs[env] = {
                ...DEFAULT_CONFIG.environmentConfigs[env],
                ...(userPreferences.environmentConfigs?.[env] || {}),
                // Synced settings win over the local ones, as with modifiers below.
                ...syncedEnv
            };
        }

        const envData = mergedEnvConfigs[activeEnv];

        const defaultProviders = new Set(envData.defaultProviders || []);
        const manifest = browser.runtime.getManifest();
        const enabledProviders = providers.filter((provider) =>
            provider?.enabled && provider?.url && isUsableProvider(provider.url, defaultProviders));
        const enabledProviderUrls = enabledProviders.map((provider) => provider.url);
        const providerKeys = enabledProviderUrls.map((url) => `${PROVIDER_KEY_PREFIX}${url}`);
        const storedProviderData = providerKeys.length > 0 ? await browser.storage.local.get(providerKeys) : {};
        const providerData = Object.fromEntries(enabledProviderUrls.map((url) =>
            [url, storedProviderData[`${PROVIDER_KEY_PREFIX}${url}`] || {}]));

        const mergedSiteConfigs = { ...DEFAULT_CONFIG.siteConfigs };
        // The providers that a domain's site came from, in the order they were applied; the last one is the
        // winner. Absent means the bundled set. model.js's sourcesForHost() builds the lookup chain from this.
        const siteConfigSources = {};

        // Folded in before the override loop below, not after: that loop is what applies
        // userSiteOverrides and fills in a default origin, and a provider-only site needs both. A
        // domain here was already resolved against the declared-scope and shadowing rules in
        // providers.js's own refresh cycle, so it is simply layered on top -- a shadowing claim
        // replaces the bundled entry outright, exactly as a provider replacing its own is expected to.
        //
        // enabled: true means something different here than it does for the bundled set below: not
        // "on", but "offered". A provider site always starts off regardless of what the provider
        // declared, and only userSiteOverrides -- the user's own choice, made through the ordinary
        // site toggle -- can turn it on; enabled: false in the provider's own data instead withdraws
        // the offer entirely, so the site never appears at all.
        //
        // A default provider publishes the bundled set itself, so its sites keep their own `enabled`,
        // as bundled sites do. A new site still needs its origin granted: isSiteEnabled() and the content
        // script registration both check the permission.
        //
        // A site whose origins this build cannot request is left out: it could never be turned on. In the store
        // build, that is a site its manifest does not declare. refreshOne() logs it once per fetch.
        for (const provider of enabledProviders) {
            const isDefault = defaultProviders.has(provider.url);
            for (const [domain, siteConfig] of Object.entries(providerData[provider.url].siteConfigs || {})) {
                if (!isDefault && !siteConfig.enabled) continue;
                const origins = siteConfig.origins || [`https://${domain}/*`];
                if (!canRequestOrigins(origins, manifest)) continue;
                mergedSiteConfigs[domain] = isDefault ? siteConfig : { ...siteConfig, enabled: false };
                (siteConfigSources[domain] ||= []).push({ url: provider.url, origins });
            }
        }

        for (const [domain, siteConfig] of Object.entries(mergedSiteConfigs)) {
            // Merge siteConfigs with sync overrides
            if (syncOverrides.hasOwnProperty(domain)) {
                const overrides = syncOverrides[domain]
                log("Applying sync override for", domain, "to", overrides);
                mergedSiteConfigs[domain] = {
                    ...siteConfig,
                    ...overrides
                };
            }

            // If origins are not set, add a default pattern
            if (!mergedSiteConfigs[domain].origins) {
                mergedSiteConfigs[domain].origins = [`https://${domain}/*`];
            }
        }

        const finalConfig = {
            ...DEFAULT_CONFIG,
            ...userPreferences, // Overwrite defaults with user choices (e.g., "enabled": false)
            ...envData,         // Flatten environment data (e.g., defaultProviders) into the top level
            modifiers: {
                ...DEFAULT_CONFIG.modifiers,
                ...(envData?.modifiers || {}),
                ...syncModifiers
            },
            environmentConfigs: mergedEnvConfigs,
            siteConfigs: mergedSiteConfigs, // Use properly merged site configs
            siteConfigSources,
            // Enabled providers only, so that a disabled one gives "no data", not its last resolved content.
            providerData,
            activeEnv: activeEnv,
            enabledProviderUrls,
            // In defaultProviders order, because a later default provider wins in getRahtiEntries().
            enabledDefaultProviderUrls: (envData.defaultProviders || []).filter((url) => enabledProviderUrls.includes(url)),
            // Synced, so the warning about the "all headlines" level is dismissed once per person
            // rather than once per device.
            clickbaitLevelWarningSeen: syncData.clickbaitLevelWarningSeen === true
        };

        // Cache the result only if the cache wasn't invalidated during the async call
        if (pendingConfigPromise === currentPromise) {
            cachedConfig = finalConfig;
            pendingConfigPromise = null;
        }

        return finalConfig;
    })();

    pendingConfigPromise = currentPromise;
    return pendingConfigPromise;
}

export { getConfig, onConfigValue, isUsableProvider, PROVIDER_KEY_PREFIX, BUNDLED_SITE_KEYS, DEFAULT_RAHTI_MANIFEST_URL };
