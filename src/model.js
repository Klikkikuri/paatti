"use strict";

import { getLogger, browser } from "./utils.js";

const log = getLogger("model");

const modelEvents = {
    statisticsChange: "statisticsChange",
    enabledChange: "enabledChange",
};

/**
 * Namespace for __model__ of model-view-controller.
 */
const model = (() => {
    ///////////////////////////////////////////////////////////////////////////////
    // Common helper procedures.
    ///////////////////////////////////////////////////////////////////////////////

    const _getSiteConfigs = async () => {
        const config = await browser().storage.local.get();
        const siteConfigs = config["siteConfigs"];
        log("The site configs in storage:", siteConfigs);

        return siteConfigs;
    };

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

    return {
        events,

        write: {
            initialize: async () => {
                _eventListeners = {};
                await browser().storage.local.clear();
                await browser().storage.local.set({
                    // CONFIG: Configure extension to start enabled here.
                    "enabled": true,
                    // CONFIG: Configure per-site settings here.
                    "siteConfigs": {
                        "www.iltalehti.fi": {
                            // These CSS selectors are used to find the elements
                            // containing text of news titles (which will be
                            // converted).
                            "linkTitleQuerySelectors": [
                                ".front-title",
                                ".title-container > .title,.title-container-most-read > .title",
                                ".newsticker-title-text",
                                ".latest-pala-video-overlay > .latest-pala-title"
                            ],
                            "enabled": false,
                        },
                        "www.hs.fi": {
                            "linkTitleQuerySelectors": [
                                "a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)",
                            ],
                            // These CSS selectors are used to find the elements
                            // that might dynamically get added elements containing
                            // convertable news titles (and need to be listened
                            // for changes while the user is browsing the site).
                            "mutationProneQuerySelectors": [
                                "section.flex:nth-child(5) > section:nth-child(1)",
                            ],
                            "enabled": false,
                        },
                        "yle.fi": {
                            "enabled": false,
                        },
                        "www.aamulehti.fi": {
                            "enabled": false,
                        },
                    },
                    "environmentConfigs": {
                        /* CONFIG: Un/comment these values to set dev mode on or off. */
                        //"environment": "production",
                        "environment": "development",
                        "debugVisualsEnabled": false,
                        // CONFIG: Configure default title data source URL here.
                        "titleDataUrl": "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json", 
                    },
                    "statistics": {},
                });
            },

            setDebugVisualsEnabled: async (value) => {
                const config = await browser().storage.local.get();
                config["environmentConfigs"]["debugVisualsEnabled"] = value;
                await browser().storage.local.set(config);
            },

            setEnabled: async (value, hostname) => {
                const config = await browser().storage.local.get();
                if (hostname) {
                    log(`Enabling '${hostname}' == ${value}`);
                    config["siteConfigs"][hostname]["enabled"] = value;
                } else {
                    log(`Enabling conversion == ${value}`);

                    config["enabled"] = value;
                }
                await browser().storage.local.set(config);

                events.dispatchEvent(modelEvents.enabledChange);
            },

            setEnvironment: async (value) => {
                const config = await browser().storage.local.get();
                log(`Setting environment from '${config["environmentConfigs"]["environment"]}' to ${value}`);

                config["environmentConfigs"]["environment"] = value;

                await browser().storage.local.set(config);
            },

            setKerran: async (value, hostname) => {
                log(`Kerraing '${hostname}' == ${value}`);

                const config = await browser().storage.local.get();
                config["siteConfigs"][hostname]["kerran"] = value;

                await browser().storage.local.set(config);
            },

            setStatistics: async (value, { hostname }) => {
                log(`Storing stats for ${hostname}:`, value);
                const config = await browser().storage.local.get();
                config["statistics"][hostname] = value;
                await browser().storage.local.set(config);

                log(`Stored stats for ${hostname}`);

                events.dispatchEvent(modelEvents.statisticsChange);
            },

            setTitleDataUrl: async (value) => {
                const config = await browser().storage.local.get();
                config["environmentConfigs"]["titleDataUrl"] = value;
                await browser().storage.local.set(config);
                // TODO: Need event here or just manually do it at controller?
            },

            setTestTitleDataUrl: async (value) => {
                const config = await browser().storage.local.get();
                config["environmentConfigs"]["testTitleDataUrl"] = value;
                await browser().storage.local.set(config);
            },
        },

        read: {
            toString: async () => {
                return JSON.stringify(await browser().storage.local.get(), null, 4);
            },

            isDevelopmentEnv: async () => {
                const environmentConfigs = (await browser().storage.local.get())["environmentConfigs"];
                return environmentConfigs.environment === "development";
            },

            isEnabled: async (hostname) => {
                const config = await browser().storage.local.get();
                const isGloballyEnabled = config["enabled"];
                if (hostname) {
                    return isGloballyEnabled && config["siteConfigs"][hostname]["enabled"];
                } else {
                    return isGloballyEnabled;
                }
            },

            isKerran: async (hostname) => {
                return (await _getSiteConfigs())[hostname]?.["kerran"];
            },

            getDebugVisualsEnabled: async () => {
                const environmentConfigs = (await browser().storage.local.get())["environmentConfigs"];
                return environmentConfigs.debugVisualsEnabled;
            },

            getSitesEnabled: async () => {
                const siteConfigs = await _getSiteConfigs();
                const sitesEnabled = Object.entries(siteConfigs)
                    .map(([k, v]) => {
                        return [k, v["enabled"]];
                    });
                return Object.fromEntries(sitesEnabled);
            },

            getTitleDataUrl: async () => {
                const environmentConfigs = (await browser().storage.local.get())["environmentConfigs"];
                return environmentConfigs.titleDataUrl;
            },

            getTestTitleDataUrl: async () => {
                const environmentConfigs = (await browser().storage.local.get())["environmentConfigs"];
                return environmentConfigs.testTitleDataUrl;
            },

            getStatistics: async (hostname) => {
                const statistics = (await browser().storage.local.get())["statistics"];
                log("The full statistics in store: ", statistics);

                const hostnameStatistics = statistics[hostname];
                log(`The statistics in store for '${hostname}':`, hostnameStatistics);

                return hostnameStatistics;
            },

            getLinkTitleQuerySelectors: async (hostname) => {
                const selectors = (await _getSiteConfigs())[hostname]["linkTitleQuerySelectors"];
                log(`The title selectors for ${hostname}:`, selectors);
                return selectors;
            },

            getMutationProneQuerySelectors: async (hostname) => {
                const selectors = (await _getSiteConfigs())[hostname]["mutationProneQuerySelectors"];
                log(`The mutation prone selectors for ${hostname}:`, selectors);
                return selectors;
            },
        },
    };
})();

export { model, modelEvents };
