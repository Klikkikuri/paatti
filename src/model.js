"use strict";

import browser from "./browser-api.js";
import { getLogger } from "./utils.js";
import { getConfig, PROVIDER_KEY_PREFIX } from "./config.js";
import { mergeStats } from "./stats.js";

const log = getLogger("model");

/**
 * Clamp a stored probability into 0..1. Values reach here from a dev-only control
 * and from preferences written by older versions, so neither range nor type is given.
 *
 * @param {*} value
 * @returns {number} A probability in 0..1; 0 for anything unusable.
 */
function clampProbability(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, 0), 1) : 0;
}

const klikkikuriStatus = Object.freeze({
    CONVERTED: "converted",
    ORIGINAL: "original",
    SKIPPED: "skipped",
    ERROR: "error",
    PAYWALLED: "paywalled"
});

/**
 * Levels of clickbaitiness, from least to most clickbaity.
 * 
 * Keep thease in sync with meri clickbaitiness levels in the backend.
 * 
 * @enum {string}
 * @readonly
 */
class Clickbaitiness {
    static LEVEL_NONE = "Not Clickbait at all";
    static LEVEL_LOW = "Slightly Clickbaity";
    static LEVEL_MODERATE = "Moderately Clickbaity";
    static LEVEL_HIGH = "Very Clickbaity";
    static LEVEL_EXTREME = "Extremely Clickbaity";

    static LEVELS = [
        Clickbaitiness.LEVEL_NONE,
        Clickbaitiness.LEVEL_LOW,
        Clickbaitiness.LEVEL_MODERATE,
        Clickbaitiness.LEVEL_HIGH,
        Clickbaitiness.LEVEL_EXTREME
    ];

    /**
     * Map a clickbaitiness level string to its corresponding numeric value (0-4).
     * @param {string} level - Clickbait level string
     * @returns {number} The numeric value, or -1 if invalid
     */
    static stringToNumber(level) {
        return Clickbaitiness.LEVELS.indexOf(level);
    }

    /**
     * Constructor for Clickbaitiness instance.
     * Can be initialized with a number or a level string.
     * @param {number|string} value - Numeric level or level string
     */
    constructor(value) {
        if (typeof value === "number") {
            this.value = value;
        } else if (typeof value === "string") {
            this.value = Clickbaitiness.stringToNumber(value);
        } else {
            this.value = -1;
        }
    }

    /**
     * Checks if the current clickbaitiness meets or exceeds a given threshold level.
     * @param {number|string} thresholdVal - Threshold level index (0-4) or string
     * @returns {boolean} True if current level is greater than or equal to threshold
     */
    meetsThreshold(thresholdVal) {
        const threshold = typeof thresholdVal === "number"
            ? thresholdVal
            : Clickbaitiness.stringToNumber(thresholdVal);
        return this.value >= threshold && this.value !== -1 && threshold !== -1;
    }
}

/**
 * Matches a hostname against an origin pattern, following browser permission matching logic.
 * Supports wildcards in hostnames (e.g., *.example.com).
 * 
 * @param {string} hostname - The hostname to test (e.g., "www.hs.fi")
 * @param {string} originPattern - The origin pattern (e.g., "https://*.hs.fi/*")
 * @returns {boolean} True if the hostname matches the pattern
 */
function matchesOrigin(hostname, originPattern) {
    try {
        const patternHost = originPattern.split("://")[1]?.split("/")[0];

        // Handle wildcard subdomain pattern (*.example.com)
        if (patternHost.startsWith("*.")) {
            const baseDomain = patternHost.slice(2); // Remove "*."
            // Match exact domain or any subdomain
            return hostname === baseDomain || hostname.endsWith("." + baseDomain);
        }

        // Handle full wildcard (*)
        if (patternHost === "*") {
            return true;
        }

        // Exact match
        return hostname === patternHost;
    } catch (e) {
        log(`Invalid origin pattern: ${originPattern}`, e);
        return false;
    }
}

/**
 * How narrowly an origin pattern names a host: an exact host beats `*.hs.fi`, a longer `*.` host beats a shorter one,
 * and `*` is the least specific.
 *
 * @param {string} originPattern
 * @returns {number}
 */
function originSpecificity(originPattern) {
    const patternHost = originPattern.split("://")[1]?.split("/")[0] ?? "";
    if (patternHost === "*") return 0;
    return patternHost.startsWith("*.") ? patternHost.length : Number.MAX_SAFE_INTEGER;
}

/**
 * Checks if a hostname matches any of the given origin patterns.
 * 
 * @param {string} hostname - The hostname to test
 * @param {string[]} origins - Array of origin patterns
 * @returns {boolean} True if hostname matches at least one origin pattern
 */
function matchesAnyOrigin(hostname, origins) {
    return origins.some(origin => matchesOrigin(hostname, origin));
}

/**
 * The `[domain, siteConfig]` entry of `siteConfigs` whose origins cover `hostname` most narrowly, or `[null, null]`.
 * A site that names the host (`www.hs.fi`) comes before one that names its subdomains (`*.hs.fi`); of equal
 * entries, the first one.
 * The one host-matching lookup `isEnabled`, `getMatchingSiteDomain`, `getSiteRules` and
 * `sourcesForHost` all need, each just reading a different field off the result.
 *
 * @param {object} siteConfigs
 * @param {string} hostname
 * @returns {[string, object]|[null, null]}
 */
function findSiteConfig(siteConfigs, hostname) {
    let best = [null, null];
    let bestSpecificity = -1;
    for (const entry of Object.entries(siteConfigs)) {
        const [, siteConfig] = entry;
        const specificity = Math.max(-1, ...(siteConfig.origins || [])
            .filter((origin) => matchesOrigin(hostname, origin))
            .map(originSpecificity));
        if (specificity > bestSpecificity) {
            best = entry;
            bestSpecificity = specificity;
        }
    }
    return best;
}

/**
 * The sources a link to `hostname` is looked up in, highest precedence first.
 *
 * The claimants come first among themselves in the order of `config.siteConfigSources`: the providers that supply the
 * site of the host and whose own origins cover it. A default provider is always a claimant when it supplies the
 * site; any other provider only when the user turned the site on. Every enabled default provider that is not a
 * claimant still answers, a later one first. With shadowing on, the claimants come before these; with shadowing
 * off, after them, so that a provider only fills the gaps in the official data.
 *
 * @param {object} config - From `getConfig()`.
 * @param {string} hostname
 * @returns {Array<{url: string, claims: boolean}>} `claims`: the provider's own site config covers the host.
 */
function sourcesForHost(config, hostname) {
    const [domain, siteConfig] = findSiteConfig(config.siteConfigs, hostname);
    const defaultUrls = config.enabledDefaultProviderUrls;

    const claimants = (config.siteConfigSources[domain] || [])
        .filter(({ url, origins }) => matchesAnyOrigin(hostname, origins) && (siteConfig?.enabled || defaultUrls.includes(url)))
        .map(({ url }) => ({ url, claims: true }));
    const claimantUrls = new Set(claimants.map(({ url }) => url));
    const otherDefaults = [...defaultUrls].reverse()
        .filter((url) => !claimantUrls.has(url))
        .map((url) => ({ url, claims: false }));
    return config.providerShadowingEnabled ? [...claimants, ...otherDefaults] : [...otherDefaults, ...claimants];
}

/** The stored data of each enabled default provider, in `defaultProviders` order. */
function defaultProviderData(config) {
    return config.enabledDefaultProviderUrls.map((url) => config.providerData[url]);
}

/**
 * Sign each URL once for each layer of its host's lookup chain, under the rules of that layer.
 *
 * A layer signs under its provider's named Suola set when the provider claims the host. A provider that has
 * Suola rules but no active set (`defineRules` refused them) gets `sign: null`: a sign from the wrong rules is
 * a valid string that no later check can catch. All other layers use the base rules.
 *
 * `officialSign` is the sign of the highest default layer. It is the base sign when no default is enabled, or when
 * that layer has no sign because its rules were refused. It identifies the link to the feedback server and in the statistics, so it must not change with provider coverage.
 *
 * @param {object} config - From `getConfig()`.
 * @param {string[]} urls
 * @param {{hashUrl: Function, activeNames: Set<string>}} suola - Suola's `hashUrl` and its `listRules()` names.
 * @returns {Object<string, {layers: Array<{source: string, sign: string|null}>, officialSign: string}|null>}
 *   Null for a URL that cannot be signed.
 */
function signUrls(config, urls, { hashUrl, activeNames }) {
    const chains = new Map();
    const signs = {};
    for (const url of urls) {
        try {
            const hostname = new URL(url).hostname;
            if (!chains.has(hostname)) chains.set(hostname, sourcesForHost(config, hostname));

            let baseSign;
            const base = () => (baseSign ??= hashUrl(url));
            const layers = chains.get(hostname).map(({ url: source, claims }) => {
                if (claims && activeNames.has(source)) return { source, sign: hashUrl(url, source) };
                if (claims && config.providerData[source].suolaRules) return { source, sign: null };
                return { source, sign: base() };
            });
            const defaultLayer = layers.find(({ source }) => config.enabledDefaultProviderUrls.includes(source));
            signs[url] = { layers, officialSign: defaultLayer?.sign ?? base() };
        } catch (err) {
            log(`Error signing URL '${url}':`, err);
            signs[url] = null;
        }
    }
    return signs;
}

/**
 * Write one field under `userPreferences.environmentConfigs[env]`, in storage.local. The shape every
 * per-environment, device-local setting uses -- currently the two provider safety toggles, which must
 * never be decided anywhere but the device they affect. See config.js's getConfig() for why this is
 * local rather than sync.
 *
 * @param {string} field
 * @param {*} value
 * @param {string} [env] - Defaults to the active environment.
 */
async function setLocalEnvField(field, value, env) {
    if (!env) env = await getConfig().then((cfg) => cfg.activeEnv);
    log(`Setting ${field} for environment '${env}' to ${value}`);

    const data = await browser.storage.local.get("userPreferences");
    const userPreferences = data.userPreferences || {};
    if (!userPreferences.environmentConfigs) userPreferences.environmentConfigs = {};
    if (!userPreferences.environmentConfigs[env]) userPreferences.environmentConfigs[env] = {};
    userPreferences.environmentConfigs[env][field] = value;
    await browser.storage.local.set({ userPreferences });
}

/**
 * Namespace for __model__ of model-view-controller.
 */
const model = (() => {
    return {
        write: {
            setEnabled: async (value, hostname) => {
                if (hostname) {
                    log(`Enabling '${hostname}' == ${value}`);
                    const data = await browser.storage.sync.get("userSiteOverrides");
                    const overrides = data.userSiteOverrides || {};
                    overrides[hostname] = overrides[hostname] || {};
                    overrides[hostname].enabled = value;
                    await browser.storage.sync.set({ userSiteOverrides: overrides });
                } else {
                    // Global enabled
                    log(`Enabling conversion == ${value}`);
                    const data = await browser.storage.local.get("userPreferences");
                    const userPreferences = data.userPreferences || {};
                    userPreferences.enabled = value;
                    await browser.storage.local.set({ userPreferences });
                }
            },

            setEnvironment: async (value) => {
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                const oldEnv = userPreferences.environment || "Unknown";
                log(`Setting environment from '${oldEnv}' to ${value}`);

                userPreferences.environment = value;
                await browser.storage.local.set({ userPreferences });
            },



            setDebugVisualsEnabled: async (value) => {
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.debugVisualsEnabled = value;
                await browser.storage.local.set({ userPreferences });
            },

            setVisualHighlightEnabled: async (value) => {
                await browser.storage.local.set({ visualHighlightEnabled: value });
            },

            setRefreshIntervalMinutes: async (value) => {
                log(`Setting refresh interval minutes to ${value}`);
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.refreshIntervalMinutes = value;
                await browser.storage.local.set({ userPreferences });
            },

            /**
             * Whether a provider may take over a site that an earlier provider already
             * supplies. Per environment, local, and read only from
             * `userPreferences.environmentConfigs[env]` -- see `getConfig()`, which strips this key
             * out of anything arriving through sync so the device it protects is always the one that
             * decides it.
             */
            setProviderShadowingEnabled: async (value, env) => setLocalEnvField("providerShadowingEnabled", value, env),

            /** Whether a provider may be reached at a loopback address. Same storage shape and reasoning as above. */
            setLoopbackProvidersEnabled: async (value, env) => setLocalEnvField("loopbackProvidersEnabled", value, env),

            setEasterEggProbability: async (value, env) => {
                // Property of an environment, like the email below, but kept in sync
                // storage so the odds follow the user between their browsers.
                if (!env) {
                    env = await getConfig().then(cfg => cfg.activeEnv);
                }
                const clamped = clampProbability(value);
                log(`Setting easter egg probability for environment '${env}' to ${clamped}`);

                const data = await browser.storage.sync.get("environmentConfigs");
                const environmentConfigs = data.environmentConfigs || {};
                if (!environmentConfigs[env]) {
                    environmentConfigs[env] = {};
                }
                environmentConfigs[env].easterEggProbability = clamped;
                await browser.storage.sync.set({ environmentConfigs });
            },

            setClickbaitLevel: async (value) => {
                log(`Setting clickbait level to ${value}`);
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.clickbaitLevel = value;
                await browser.storage.local.set({ userPreferences });
            },

            /** Records that the "All headlines" warning was seen. Set once, never cleared. */
            acknowledgeClickbaitLevelWarning: async () => {
                log("Acknowledging the clickbait level warning");
                await browser.storage.sync.set({ clickbaitLevelWarningSeen: true });
            },

            /**
             * Accumulate a page snapshot delta into persisted cumulative statistics.
             *
             * @param {{ groupedByClickbaitiness: Object.<string,number>,
             *   convertedByClickbaitiness: Object.<string,number> }} delta
             * @param {{ domain: string }} options - Target site domain key.
             */
            addStatistics: async (delta, { domain }) => {
                log(`Adding stats delta for domain '${domain}'`);
                const data = await browser.storage.local.get("statistics");
                const statistics = data.statistics || {};

                // Merge the incoming clickbaitiness counts into the domain's totals.
                statistics[domain] = mergeStats(statistics[domain], delta);

                await browser.storage.local.set({ statistics });
                log(`Stored cumulative stats for '${domain}':`, statistics[domain]);
            },

            /** Drop every site's tally, the legacy `_global` one included, as on a fresh install. */
            resetStatistics: async () => {
                log("Resetting statistics");
                await browser.storage.local.remove("statistics");
            },

            setTitleDataUrl: async (value) => {
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                if (!userPreferences.titleDataUrls) {
                    userPreferences.titleDataUrls = [];
                }
                userPreferences.titleDataUrls = [value];
                await browser.storage.local.set({ userPreferences });
                // TODO: Need event here or just manually do it at controller?
            },

            setTestTitleDataUrl: async (value) => {
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.testTitleDataUrl = value;
                await browser.storage.local.set({ userPreferences });
            },

            setEmail: async (value, env) => {
                // Email is property of environment
                if (!env) {
                    env = await getConfig().then(cfg => cfg.activeEnv);
                }
                log(`Setting email for environment '${env}' to '${value}'`);
                const data = await browser.storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                if (!userPreferences.environmentConfigs) {
                    userPreferences.environmentConfigs = {};
                }
                if (!userPreferences.environmentConfigs[env]) {
                    userPreferences.environmentConfigs[env] = {};
                }
                userPreferences.environmentConfigs[env].email = value;
                await browser.storage.local.set({ userPreferences });
            },

            setModifierEnabled: async (name, value) => {
                log(`Setting modifier '${name}' to ${value} in sync storage`);
                const syncData = await browser.storage.sync.get("modifiers");
                const modifiers = syncData.modifiers || {};
                modifiers[name] = value;
                await browser.storage.sync.set({ modifiers });
            },

        },

        read: {
            toString: async () => {
                const [local, sync] = await Promise.all([
                    browser.storage.local.get(),
                    browser.storage.sync.get()
                ]);
                return JSON.stringify({ local, sync }, null, 4);
            },

            isDevelopmentEnv: async () => {
                const config = await getConfig();
                return config.activeEnv === "development";
            },

            getEnvironment: async () => {
                const config = await getConfig();
                return config.activeEnv;
            },

            isEnabled: async (hostname) => {
                const config = await getConfig();
                const isGloballyEnabled = config.enabled;

                if (!hostname) {
                    return isGloballyEnabled;
                }

                const [, siteConfig] = findSiteConfig(config.siteConfigs, hostname);
                return siteConfig ? isGloballyEnabled && siteConfig.enabled : false;
            },



            isDebugVisualsEnabled: async () => {
                const config = await getConfig();
                return config["debugVisualsEnabled"];
            },

            getVisualHighlightEnabled: async () => {
                const data = await browser.storage.local.get("visualHighlightEnabled");
                if (data.hasOwnProperty("visualHighlightEnabled")) {
                    return !!data.visualHighlightEnabled;
                }
                const config = await getConfig();
                return !!config.debugVisualsEnabled;
            },

            /**
             * The active environment's default provider(s) own timestamps now, not a flat storage key:
             * the official dataset is itself a provider (see config.js's defaultProviders), so its
             * "last checked"/"generation date" live in its own provider namespace, same as any other.
             * A disabled default provider is excluded -- it must read as having no data, not stale
             * leftovers from before it was turned off.
             *
             * `lastDatabaseUpdate` is the last refresh with no fetch error; `lastDatabaseCheck` is the last
             * attempt, failed or not. Content stored before `checked` existed falls back to `updated`.
             */
            getDatabaseStatus: async () => {
                const config = await getConfig();
                const results = defaultProviderData(config);
                return {
                    lastDatabaseUpdate: results.reduce((max, r) => Math.max(max, r.updated || 0), 0) || null,
                    lastDatabaseCheck: results.reduce((max, r) => Math.max(max, r.checked || r.updated || 0), 0) || null,
                    databaseGenerationDate: results.reduce((max, r) =>
                        (r.databaseGenerationDate && (!max || new Date(r.databaseGenerationDate) > new Date(max)))
                            ? r.databaseGenerationDate : max, null)
                };
            },

            /**
             * How many titles the local database holds, summed across the active environment's enabled
             * default provider(s). Reads each provider's own `entryCount` field, computed once at refresh
             * time by refreshOne, so that a status read does not count `rahtiData`. A summed count, not a
             * true set union: today there is exactly one default provider per environment, so this is
             * exact; a future second default provider whose data overlaps the first on some `sign` would
             * be a minor overcount, accepted
             * as this is a UI "roughly how much data" signal, not used for correctness.
             *
             * This, not lastDatabaseUpdate, is the test for an empty database. That timestamp is
             * evidence of a fetch and never of content -- it is written on an all-304 response,
             * which touches no data, and a successful fetch can fail to write it at all.
             *
             * @returns {Promise<number>} Entry count, 0 when nothing has been stored.
             */
            getDatabaseEntryCount: async () => {
                const config = await getConfig();
                const results = defaultProviderData(config);
                return results.reduce((sum, r) => sum + (r.entryCount || 0), 0);
            },

            /**
             * The salt that gives this install its own easter egg calendar.
             *
             * Local and not sync, and a key of its own rather than a setting: it is a
             * property of the install, not something the user chose. Without it every
             * Paatti on earth would hash the same date to the same number and show the
             * artwork on the same days.
             *
             * Written on the first read, so there is nothing to migrate. Two pages that
             * race on a fresh install can both generate one and the last write wins;
             * that costs one page one day of a different calendar, and no more.
             */
            getEasterEggSalt: async () => {
                const data = await browser.storage.local.get("easterEggSalt");
                if (typeof data.easterEggSalt === "string" && data.easterEggSalt) {
                    return data.easterEggSalt;
                }

                const salt = crypto.randomUUID();
                log("Generating an easter egg salt for this install");
                await browser.storage.local.set({ easterEggSalt: salt });

                return salt;
            },

            getClickbaitLevel: async () => {
                const config = await getConfig();
                return config.clickbaitLevel !== undefined ? config.clickbaitLevel : 2;
            },

            shouldConvert: async (clickbaitinessLevel) => {
                const config = await getConfig();
                const sliderVal = config.clickbaitLevel !== undefined ? config.clickbaitLevel : 2;
                const clickbaitiness = new Clickbaitiness(clickbaitinessLevel);
                return clickbaitiness.meetsThreshold(sliderVal);
            },

            getSitesEnabled: async () => {
                const config = await getConfig();
                const sitesEnabled = Object.entries(config.siteConfigs)
                    .map(([k, v]) => {
                        return [k, v.enabled];
                    });
                return Object.fromEntries(sitesEnabled);
            },

            getMatchingSiteDomain: async (hostname) => {
                if (!hostname) return null;
                const config = await getConfig();
                const [domain] = findSiteConfig(config.siteConfigs, hostname);
                return domain;
            },

            getSiteRules: async (hostname) => {
                const config = await getConfig();
                const [, siteConfig] = findSiteConfig(config.siteConfigs, hostname);
                return siteConfig ? siteConfig.rules : null;
            },

            /**
             * The Rahti entry of each link, from the first layer of its chain that has the layer's sign.
             *
             * Reads the provider data that `getConfig()` already holds, so a page of links costs no
             * storage reads. A layer of a provider that is not enabled now is skipped.
             *
             * @param {Object<string, {layers: Array<{source: string, sign: string|null}>}|null>} signsByUrl - From `signUrls()`.
             * @returns {Promise<Object<string, object|null>>} By the same keys.
             */
            getRahtiEntries: async (signsByUrl) => {
                const { providerData } = await getConfig();
                const entryOf = ({ source, sign }) => (sign ? providerData[source]?.rahtiData?.[sign] : undefined);
                const entries = {};
                for (const [url, signs] of Object.entries(signsByUrl)) {
                    const layer = signs?.layers.find((candidate) => entryOf(candidate) !== undefined);
                    entries[url] = layer ? entryOf(layer) : null;
                }
                return entries;
            },


            getTestTitleDataUrl: async () => {
                const config = await getConfig();
                return config.testTitleDataUrl;
            },

            getStatistics: async (hostname) => {
                const data = await browser.storage.local.get("statistics");
                const statistics = data.statistics || {};
                log("The full statistics in store: ", statistics);

                const hostnameStatistics = statistics[hostname];
                log(`The statistics in store for '${hostname}':`, hostnameStatistics);

                return hostnameStatistics;
            },

            getAllStatistics: async () => {
                const data = await browser.storage.local.get("statistics");
                return data.statistics || {};
            },

            getLinkTitleQuerySelectors: async (hostname) => {
                const config = await getConfig();
                const [, siteConfig] = findSiteConfig(config.siteConfigs, hostname);
                const selectors = siteConfig?.linkTitleQuerySelectors;
                log(`The title selectors for ${hostname}:`, selectors);
                return selectors;
            },

            getMutationProneQuerySelectors: async (hostname) => {
                const config = await getConfig();
                const [, siteConfig] = findSiteConfig(config.siteConfigs, hostname);
                const selectors = siteConfig?.mutationProneQuerySelectors;
                log(`The mutation prone selectors for ${hostname}:`, selectors);
                return selectors;
            },

            getEmail: async () => {
                const config = await getConfig();
                const env = config.activeEnv;
                const email = config.environmentConfigs[env]?.email || "";
                log(`Retrieved email for environment '${env}': '${email}'`);
                return email;
            },

            getMarkAiSlop: async () => {
                const config = await getConfig();
                return !!config.modifiers?.aiSlop;
            },

            /**
             * Whether the video content modifier is enabled in user settings.
             * @returns {Promise<boolean>}
             */
            getMarkVideo: async () => {
                const config = await getConfig();
                return !!config.modifiers?.video;
            },

            /**
             * Whether the converted headline modifier is enabled in user settings.
             * @returns {Promise<boolean>}
             */
            getMarkConverted: async () => {
                const config = await getConfig();
                return !!config.modifiers?.converted;
            }
        },

        watch: {
            /**
             * Calls back whenever any provider's resolved data changes in storage.local -- the signal
             * that getDatabaseStatus()/getDatabaseEntryCount() may now read something different.
             *
             * Matches by the shared `provider:` prefix rather than a fixed key, because which URLs
             * matter is environment-dependent (config.defaultProviders varies by environment) and can
             * change at runtime; the caller's own re-read of getDatabaseStatus()/getDatabaseEntryCount()
             * is what actually decides relevance. This does over-fire on a third-party provider's data
             * changing too -- accepted, since those two functions read the cached config, which loads
             * again once per change, and correctness (never missing a relevant change)
             * matters more here than trimming an occasional redundant refresh.
             *
             * @param {() => void} callback
             * @returns {() => void} Unsubscribes when called.
             */
            onDatabaseStatusChanged: (callback) => {
                const listener = (changes, areaName) => {
                    if (areaName !== "local") return;
                    if (!Object.keys(changes).some((key) => key.startsWith(PROVIDER_KEY_PREFIX))) return;
                    callback();
                };
                browser.storage.onChanged.addListener(listener);
                return () => browser.storage.onChanged.removeListener(listener);
            }
        }
    };
})();

export { model, klikkikuriStatus, Clickbaitiness, clampProbability, matchesAnyOrigin, signUrls };
