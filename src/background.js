"use strict";

import { browser, getLogger } from "./utils.js";
import { getConfig } from "./config.js";
import { fetchRahtiData } from "./rahti.js";
import { controller } from "./controller.js";

const log = getLogger("background");

const DEFAULT_ENVIRONMENT = "free";
const PULL_ALARM_NAME = "periodic-data-pull";

async function updateDynamicContentScripts() {
    try {
        const config = await getConfig();
        const enabledOrigins = [];

        if (config.enabled) {
            for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                if (siteConfig.enabled && siteConfig.origins) {
                    enabledOrigins.push(...siteConfig.origins);
                }
            }
        }

        try {
            await browser().scripting.unregisterContentScripts({ ids: ["paatti-content-script"] });
        } catch (e) {
            // Ignore if not registered yet
        }

        if (enabledOrigins.length > 0) {
            log("Registering content scripts for origins:", enabledOrigins);
            await browser().scripting.registerContentScripts([{
                id: "paatti-content-script",
                js: [
                    "suola/build/wasm_exec.js",
                    "suola/build/suola.js",
                    "src/contentScript.js"
                ],
                css: [
                    "src/contentStyle.css"
                ],
                matches: enabledOrigins,
                runAt: "document_idle"
            }]);
        } else {
            log("No origins enabled, no content scripts registered.");
        }
    } catch (err) {
        log("Error updating dynamic content scripts:", err);
    }
}

async function scheduleAlarm(minutes) {
    await browser().alarms.clear(PULL_ALARM_NAME);
    browser().alarms.create(PULL_ALARM_NAME, {
        periodInMinutes: minutes
    });
    log(`Alarm rescheduled for every ${minutes} minutes.`);
}

/**
 * Handle alarm settings changes.
 */
browser().storage.onChanged.addListener(async (changes, area) => {
    const isPreferencesChanged = area === 'local' && changes.userPreferences;
    const isOverridesChanged = area === 'sync' && changes.userSiteOverrides;

    if (isPreferencesChanged || isOverridesChanged) {
        log("Config changed, updating dynamic content scripts...");
        await updateDynamicContentScripts();
    }

    if (isPreferencesChanged) {
        const oldVal = changes.userPreferences.oldValue || {};
        const newVal = changes.userPreferences.newValue || {};
        if (newVal.refreshIntervalMinutes !== oldVal.refreshIntervalMinutes || newVal.environment !== oldVal.environment) {
            const config = await getConfig();
            const intervalMinutes = config.refreshIntervalMinutes || 20;
            log(`Effective refresh interval is now ${intervalMinutes} minutes.`);
            await scheduleAlarm(intervalMinutes);
        }
        if (newVal.clickbaitLevel !== oldVal.clickbaitLevel || newVal.enabled !== oldVal.enabled) {
            log("Clickbait level or extension status changed, notifying active tab");
            try {
                const tabs = await browser().tabs.query({ active: true, currentWindow: true });
                if (tabs[0] && tabs[0].id) {
                    await browser().tabs.sendMessage(tabs[0].id, { command: "convertClickbaits" });
                }
            } catch (err) {
                // ignore error if tab doesn't have listener
                log("Tab message send failed (likely no listener):", err);
            }
        }
    }
});

browser().runtime.onInstalled.addListener(async () => {

    // Detect environment
    const environment = await new Promise((resolve) => {
        browser().management.getSelf((info) => {
            if (info.installType === 'development') {
                resolve("development");
            } else {
                resolve(DEFAULT_ENVIRONMENT);
            }
        });
    });

    try {
        // Set default environment on install
        await browser().storage.local.set({ userPreferences: { environment: environment } });
        log(`Set default environment to '${environment}' on install.`);
    } catch (error) {
        log("Error setting default environment on install:", error);
    }

    // Initial fetch of Rahti data
    try {
        await fetchRahtiData();
    } catch (err) {
        log("Failed to perform initial fetch of Rahti data on install:", err);
    }

    // Set up periodic fetching of Rahti data
    const config = await getConfig();
    const intervalMinutes = config.refreshIntervalMinutes || 30;

    await scheduleAlarm(intervalMinutes);
    await updateDynamicContentScripts();
});

// Handle periodic alarm to fetch Rahti data
browser().alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PULL_ALARM_NAME) {
        log("Alarm triggered: fetching Rahti data.");
        fetchRahtiData().catch((err) => {
            log("Failed to fetch Rahti data on alarm:", err);
        });
    }
});

// Handle manual database update requests from options and popup pages
browser().runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateDatabase") {
        log("Manual database update requested.");
        fetchRahtiData({ force: true })
            .then((success) => {
                if (success) {
                    browser().storage.local.get("lastDatabaseUpdate").then((result) => {
                        sendResponse({ success: true, lastDatabaseUpdate: result.lastDatabaseUpdate });
                    });
                } else {
                    sendResponse({ success: false, error: "Tietokannan haku epäonnistui kaikista osoitteista." });
                }
            })
            .catch((error) => {
                log("Manual database update failed:", error);
                sendResponse({ success: false, error: error.message || String(error) });
            });
        return true; // Keep message channel open for async response
    }
});

// Perform initial update of dynamic content scripts on startup
updateDynamicContentScripts().catch((err) => {
    log("Failed to run initial script update:", err);
});

// Ensure periodic alarm is scheduled on startup if missing
browser().alarms.get(PULL_ALARM_NAME).then(async (alarm) => {
    if (!alarm) {
        try {
            const config = await getConfig();
            const intervalMinutes = config.refreshIntervalMinutes || 30;
            await scheduleAlarm(intervalMinutes);
        } catch (err) {
            log("Failed to schedule alarm on startup:", err);
        }
    }
}).catch((err) => {
    log("Failed to check alarm status on startup:", err);
});

// Listen to browser permission additions to synchronize model state
browser().permissions.onAdded.addListener(async (permissions) => {
    log("Permissions added:", permissions);
    if (permissions.origins) {
        const config = await getConfig();
        for (const origin of permissions.origins) {
            for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                if (siteConfig.origins && siteConfig.origins.includes(origin)) {
                    log(`Enabling site in storage for matched origin: ${domain}`);
                    await controller.setSiteEnabled(true, domain);
                }
            }
        }
    }
});

// Listen to browser permission removals to synchronize model state
browser().permissions.onRemoved.addListener(async (permissions) => {
    log("Permissions removed:", permissions);
    if (permissions.origins) {
        const config = await getConfig();
        for (const origin of permissions.origins) {
            for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                if (siteConfig.origins && siteConfig.origins.includes(origin)) {
                    log(`Disabling site in storage for revoked origin: ${domain}`);
                    await controller.setSiteEnabled(false, domain);
                }
            }
        }
    }
});
