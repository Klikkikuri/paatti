"use strict";

import { browser, getLogger } from "./utils.js";

const log = getLogger("config");

const DEFAULT_ENV = {
    "debugVisualsEnabled": false,
    "refreshIntervalMinutes": 20,
    "titleDataUrls": ["https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"],
}

const DEFAULT_CONFIG = {
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
            "linkTitleQuerySelectors": [
                // This empty selector means that the a-tag selector (which is
                // used by default) will contain the needed title text.
                "",
            ],
            "enabled": true,
        },
        "www.aamulehti.fi": {
            "enabled": false,
        },
    },

    "environmentConfigs": {
        "free": {...DEFAULT_ENV,
            "debugVisualsEnabled": false,
            "titleDataUrls": ["https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"],
        },
        "development": {...DEFAULT_ENV,
            "debugVisualsEnabled": true,
            "refreshIntervalMinutes": 1,
            "titleDataUrls": [
                "http://localhost:3000/data.json",
                "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"
            ],
        },
    },
    "statistics": {},
};

/**
 * Gets the merged configuration for the current environment.
 */
async function getConfig() {
    const [localData, syncData] = await Promise.all([
        browser().storage.local.get("userPreferences"),
        browser().storage.sync.get("userSiteOverrides")
    ]);

    const userPreferences = localData.userPreferences || {};
    const syncOverrides = syncData.userSiteOverrides || {}; // Structure: { "yle.fi": false }

    const activeEnv = userPreferences.environment || DEFAULT_CONFIG.environment;

    const envData = DEFAULT_CONFIG.environmentConfigs[activeEnv];

    // Merge siteConfigs with sync overrides
    const mergedSiteConfigs = { ...DEFAULT_CONFIG.siteConfigs };
    for (const [domain, enabledStatus] of Object.entries(syncOverrides)) {
        if (mergedSiteConfigs[domain]) {
            log("Applying sync override for", domain, "to", enabledStatus);
            mergedSiteConfigs[domain].enabled = enabledStatus;
        } else {
            // If user added a site not in defaults, initialize it
            mergedSiteConfigs[domain] = { enabled: enabledStatus };
        }
    }

    // Return the merged final config
    return {
        ...DEFAULT_CONFIG,
        ...userPreferences, // Overwrite defaults with user choices (e.g., "enabled": false)
        siteConfigs: mergedSiteConfigs, // Use properly merged site configs
        activeEnv: activeEnv,
        ...envData    // Flatten environment data (e.g., titleDataUrl) into the top level
    };
}

export { getConfig };


/**
async function toggleSite(domain, isEnabled) {
    const data = await browser().storage.sync.get("userSiteOverrides");
    const overrides = data.userSiteOverrides || {};

    overrides[domain] = isEnabled;

    await browser().storage.sync.set({ "userSiteOverrides": overrides });
}
 */