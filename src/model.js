"use strict";

import { getLogger, browser } from "./utils.js";
import { getConfig } from "./config.js";

const log = getLogger("model");

const modelEvents = {
    statisticsChange: "statisticsChange",
    enabledChange: "enabledChange",
    environmentChange: "environmentChange"
};

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
 * Namespace for __model__ of model-view-controller.
 */
const model = (() => {
    ///////////////////////////////////////////////////////////////////////////////
    // The events at home.
    ///////////////////////////////////////////////////////////////////////////////
    let _eventListeners = {};
    const events = {
        addEventListener: (event, handler) => {
            if (!_eventListeners[event]) {
                _eventListeners[event] = [];
            }
            _eventListeners[event].push(handler);
        },
        removeEventListener: (event, handler) => {
            const handlers = _eventListeners[event];
            if (!handlers) {
                log(`No handlers to remove from the event '${event}'`);
                return;
            }
            const idx = handlers.indexOf(handler);
            handlers.splice(idx, 1);
        },
        dispatchEvent: (event) => {
            const handlers = _eventListeners[event];
            if (!handlers) {
                log(`No handlers for the dispatched event '${event}'`);
                return;
            }
            log(`Dispatching ${handlers.length} ${handlers.length > 1 ? "handlers" : "handler"} for event '${event}'`);
            for (const handler of (_eventListeners[event] ?? [])) {
                handler();
            }
        },
    };

    const config = getConfig();

    return {
        events,

        write: {
            initialize: async () => {
                _eventListeners = {};
            },

            setEnabled: async (value, hostname) => {
                if (hostname) {
                    log(`Enabling '${hostname}' == ${value}`);
                    const data = await browser().storage.sync.get("userSiteOverrides");
                    const overrides = data.userSiteOverrides || {};
                    overrides[hostname] = overrides[hostname] || {};
                    overrides[hostname].enabled = value;
                    await browser().storage.sync.set({ userSiteOverrides: overrides });
                } else {
                    // Global enabled
                    log(`Enabling conversion == ${value}`);
                    const data = await browser().storage.local.get("userPreferences");
                    const userPreferences = data.userPreferences || {};
                    userPreferences.enabled = value;
                    await browser().storage.local.set({ userPreferences });
                }

                events.dispatchEvent(modelEvents.enabledChange);
            },

            setEnvironment: async (value) => {
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                const oldEnv = userPreferences.environment || "Unknown";
                log(`Setting environment from '${oldEnv}' to ${value}`);

                userPreferences.environment = value;
                await browser().storage.local.set({ userPreferences });

                events.dispatchEvent(modelEvents.environmentChange);
            },



            setDebugVisualsEnabled: async (value) => {
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.debugVisualsEnabled = value;
                await browser().storage.local.set({ userPreferences });
            },

            setClickbaitLevel: async (value) => {
                log(`Setting clickbait level to ${value}`);
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.clickbaitLevel = value;
                await browser().storage.local.set({ userPreferences });
            },

            setStatistics: async (value, { hostname }) => {
                log(`Storing stats for ${hostname}`);
                const data = await browser().storage.local.get("statistics");
                const statistics = data.statistics || {};
                statistics[hostname] = value;
                await browser().storage.local.set({ statistics });

                log(`Stored stats for ${hostname}:`, statistics[hostname]);

                events.dispatchEvent(modelEvents.statisticsChange);
            },

            setTitleDataUrl: async (value) => {
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                if (!userPreferences.titleDataUrls) {
                    userPreferences.titleDataUrls = [];
                }
                userPreferences.titleDataUrls = [value];
                await browser().storage.local.set({ userPreferences });
                // TODO: Need event here or just manually do it at controller?
            },

            setTestTitleDataUrl: async (value) => {
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.testTitleDataUrl = value;
                await browser().storage.local.set({ userPreferences });
            },

            setEmail: async (value, env) => {
                // Email is property of environment
                if (!env) {
                    env = await getConfig().then(cfg => cfg.activeEnv);
                }
                log(`Setting email for environment '${env}' to '${value}'`);
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                if (!userPreferences.environmentConfigs) {
                    userPreferences.environmentConfigs = {};
                }
                if (!userPreferences.environmentConfigs[env]) {
                    userPreferences.environmentConfigs[env] = {};
                }
                userPreferences.environmentConfigs[env].email = value;
                await browser().storage.local.set({ userPreferences });
            },

            setModifierEnabled: async (name, value) => {
                log(`Setting modifier '${name}' to ${value} in sync storage`);
                const syncData = await browser().storage.sync.get("modifiers");
                const modifiers = syncData.modifiers || {};
                modifiers[name] = value;
                await browser().storage.sync.set({ modifiers });
            },

        },

        read: {
            toString: async () => {
                const [local, sync] = await Promise.all([
                    browser().storage.local.get(),
                    browser().storage.sync.get()
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

                // Find matching site config by checking if hostname matches any origin pattern
                for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                    if (siteConfig.origins && matchesAnyOrigin(hostname, siteConfig.origins)) {
                        return isGloballyEnabled && siteConfig.enabled;
                    }
                }

                return false;
            },



            isDebugVisualsEnabled: async () => {
                const config = await getConfig();
                return config["debugVisualsEnabled"];
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
                for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                    if (siteConfig.origins && matchesAnyOrigin(hostname, siteConfig.origins)) {
                        return domain;
                    }
                }
                return null;
            },

            getSiteRules: async (hostname) => {
                const config = await getConfig();
                for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                    if (siteConfig.origins && matchesAnyOrigin(hostname, siteConfig.origins)) {
                        return siteConfig.rules;
                    }
                }
                return null;
            },


            getTitleDataUrls: async () => {
                const config = await getConfig();
                return config.titleDataUrls;
            },

            getTestTitleDataUrl: async () => {
                const config = await getConfig();
                return config.testTitleDataUrl;
            },

            getStatistics: async (hostname) => {
                const data = await browser().storage.local.get("statistics");
                const statistics = data.statistics || {};
                log("The full statistics in store: ", statistics);

                const hostnameStatistics = statistics[hostname];
                log(`The statistics in store for '${hostname}':`, hostnameStatistics);

                return hostnameStatistics;
            },

            getLinkTitleQuerySelectors: async (hostname) => {
                const config = await getConfig();
                const selectors = config.siteConfigs[hostname]?.linkTitleQuerySelectors;
                log(`The title selectors for ${hostname}:`, selectors);
                return selectors;
            },

            getMutationProneQuerySelectors: async (hostname) => {
                const config = await getConfig();
                const selectors = config.siteConfigs[hostname]?.mutationProneQuerySelectors;
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
            }
        },
    };
})();

export { model, modelEvents, klikkikuriStatus, Clickbaitiness };
