"use strict";

import { browser, getLogger } from "./utils.js";
import { getConfig } from "./config.js";
import { fetchRahtiData } from "./rahti.js";

const log = getLogger("background");

const DEFAULT_ENVIRONMENT = "free";
const PULL_ALARM_NAME = "periodic-data-pull";

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
browser().storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.userPreferences) {
        const oldVal = changes.userPreferences.oldValue || {};
        const newVal = changes.userPreferences.newValue || {};
        if (newVal.refreshIntervalMinutes !== oldVal.refreshIntervalMinutes) {
            log(`Refresh interval changed from ${oldVal.refreshIntervalMinutes} to ${newVal.refreshIntervalMinutes}`);
            scheduleAlarm(newVal.refreshIntervalMinutes || 20);
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
    await fetchRahtiData();

    // Set up periodic fetching of Rahti data
    const config = await getConfig();
    const intervalMinutes = config.refreshIntervalMinutes || 30;

    scheduleAlarm(intervalMinutes);

    setInterval(fetchRahtiData, intervalMinutes * 60 * 1000);
});

// Handle periodic alarm to fetch Rahti data
browser().alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PULL_ALARM_NAME) {
        log("Alarm triggered: fetching Rahti data.");
        fetchRahtiData();
    }
});

// Handle manual database update requests from options and popup pages
browser().runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateDatabase") {
        log("Manual database update requested.");
        fetchRahtiData()
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
