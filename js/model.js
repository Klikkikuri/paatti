"use strict";

const modelEvents = {
    statisticsChange: "statisticsChange",
    enabledChange: "enabledChange",
};

///////////////////////////////////////////////////////////////////////////////
// Common helper procedures.
///////////////////////////////////////////////////////////////////////////////

const _setEnabled = async (value, { hostname } = { hostname: null }) => {
    const config = await browser.storage.local.get();
    if (hostname) {
        // Kerran cannot be on if settings to always off.
        config["siteConfigs"][hostname]["kerran"] = !value;
        config["siteConfigs"][hostname]["enabled"] = value;
        if (value) {
            // Turning on one site turns on the extension also.
            config["enabled"] = value;
        }
    } else {
        config["enabled"] = value;
    }
    await browser.storage.local.set(config);
};

const _getSiteConfigs = async () => {
    const config = await browser.storage.local.get();
    const siteConfigs = config.siteConfigs;
    log("The site configs in storage:", siteConfigs);

    return siteConfigs;
};

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
            handlers.splice(_eventListeners[event].indexOf(handler), 1);
        },
        dispatchEvent: (event) => {
            const handlers = _eventListeners[event];
            if (!handlers) {
                log(`No handlers for the dispatched event '${event}'`);
                return;
            }
            log(`Dispatching ${handlers} for event '${event}'`);
            for (const handler of (_eventListeners[event] ?? [])) {
                handler();
            }
        },
    };

    return {
        ...events,
        initialize: async () => {
            _eventListeners = {};
            await browser.storage.local.clear();
            await browser.storage.local.set({
                // CONFIG: Configure extension to start enabled here.
                "enabled": true,
                // CONFIG: Configure per-site settings here.
                "siteConfigs": {
                    "www.iltalehti.fi": {
                        "linkTitleQuerySelectors": [
                            ".front-title",
                            ".title-container,.title-container-most-read > .title",
                            ".newsticker-title-text",
                            ".latest-pala-video-overlay > .latest-pala-title"
                        ],
                        "enabled": false,
                    },
                    "www.hs.fi": {
                        "linkTitleQuerySelectors": [
                            "a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)",
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
                },
                "statistics": {},
            });
        },

        toString: async () => {
            return JSON.stringify(await browser.storage.local.get(), null, 4);
        },

        isDevelopmentEnv: async () => {
            const environmentConfigs = (await browser.storage.local.get("environmentConfigs"))
                .environmentConfigs;
            return environmentConfigs.environment === "development";
        },

        isConversionEnabled: async (hostname) => {
            const config = await browser.storage.local.get();
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

        getSitesEnabled: async () => {
            const siteConfigs = await _getSiteConfigs();
            const sitesEnabled = Object.entries(siteConfigs)
                .map(([k, v]) => {
                    return [k, v["enabled"]];
                });
            return Object.fromEntries(sitesEnabled);
        },

        getStatistics: async (hostname) => {
            const statistics = (await browser.storage.local.get()).statistics;
            log("The full stored statistics: ", statistics);

            const hostnameStatistics = statistics[hostname];
            log(`The statistics stored for '${hostname}':`, hostnameStatistics);

            return hostnameStatistics;
        },

        getLinkTitleQuerySelectors: async (hostname) => {
            const selectors = (await browser.storage.local.get()).siteConfigs[hostname].linkTitleQuerySelectors;
            log(`The title selectors for ${hostname}:`, selectors);
            return selectors;
        },

        setEnabled: async (value, hostname) => {
            await _setEnabled(value, hostname);
            events.dispatchEvent(modelEvents.enabledChange);
            // TODO This sort of back-and-forth is not so nice...maybe lift totally to controller instead?
            controller.runConversion();
        },

        setKerran: async (value, hostname) => {
            const config = await browser.storage.local.get();
            config["siteConfigs"][hostname]["kerran"] = value;

            await browser.storage.local.set(config);
            await _setEnabled(!value, { hostname: hostname });

            events.dispatchEvent(modelEvents.enabledChange);
            // TODO This sort of back-and-forth is not so nice...maybe lift totally to controller instead?
            controller.runConversion();
        },

        resetKerran: async (hostname) => {
            const config = await browser.storage.local.get();
            if (!config["siteConfigs"][hostname]["enabled"] && config["siteConfigs"][hostname]["kerran"]) {
                config["siteConfigs"][hostname]["enabled"] = true;
                config["siteConfigs"][hostname]["kerran"] = false;
                await browser.storage.local.set(config);
            }
        },

        updateStatistics: async ({ hostname, restoreTitleData, links }) => {
            const siteStats = {
                "titles": {
                    "pageClickbaitsCount": restoreTitleData
                        ? Object.values(restoreTitleData)
                            .filter((x) => x.title !== undefined)
                            .length
                        : undefined,
                    "labelNot": 0,
                    "labelSlightly": 0,
                    "labelVery": 0,
                    "labelExtremely": 0,
                },
                "misc": {
                    "linksCount": links.length,
                },
            };

            log(`Storing stats for ${hostname}:`, siteStats);

            const config = await browser.storage.local.get();
            config["statistics"][hostname] = siteStats;
            await browser.storage.local.set(config);

            log(`Stored stats for ${hostname}`);

            events.dispatchEvent(modelEvents.statisticsChange);
        },
    };
})();
