"use strict";

import { getLogger, browser } from "./utils.js";
import { getConfig } from "./config.js";

const log = getLogger("model");

const modelEvents = {
    statisticsChange: "statisticsChange",
    enabledChange: "enabledChange",
};

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
        const url = new URL(originPattern);
        const patternHost = url.hostname;

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

            setDebugVisuals: async (value) => {
                const data = await browser().storage.local.get("userPreferences");
                const userPreferences = data.userPreferences || {};
                userPreferences.debugVisualsEnabled = value;
                await browser().storage.local.set({ userPreferences });
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
            },

            setStatistics: async (value, { hostname }) => {
                log(`Storing stats for ${hostname}:`, value);
                const data = await browser().storage.local.get("statistics");
                const statistics = data.statistics || {};
                statistics[hostname] = value;
                await browser().storage.local.set({ statistics });

                log(`Stored stats for ${hostname}`);

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

            getDebugVisualsEnabled: async () => {
                const config = await getConfig();
                return config.debugVisualsEnabled;
            },

            getSitesEnabled: async () => {
                const config = await getConfig();
                const sitesEnabled = Object.entries(config.siteConfigs)
                    .map(([k, v]) => {
                        return [k, v.enabled];
                    });
                return Object.fromEntries(sitesEnabled);
            },

            getSiteRules: async (hostname) => {
                return await getConfig().then((cfg) => cfg.siteConfigs[hostname].rules);
            },

            getTitleDataUrl: async () => {
                const config = await getConfig();
                return config.titleDataUrls?.[0];
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
            }
        },
    };
})();

export { model, modelEvents };
