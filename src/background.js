"use strict";

import { browser, getLogger } from "./utils.js";
import { getConfig } from "./config.js";
import { fetchRahtiData } from "./rahti.js";

const log = getLogger("background");

const DEFAULT_ENVIRONMENT = "free";
const PULL_ALARM_NAME = "periodic-data-pull";

async function scheduleAlarm(minutes) {
    await browser.alarms.clear(PULL_ALARM_NAME);
    browser.alarms.create(PULL_ALARM_NAME, {
        periodInMinutes: minutes
    });
    log(`Alarm rescheduled for every ${minutes} minutes.`);
}

/**
 * Handle alarm settings changes.
 */
// browser.storage.onChanged.addListener((changes, area) => {
//   if (area === 'local' && changes.refreshIntervalMinutes) {
//     scheduleAlarm(changes.refreshIntervalMinutes.newValue);
//   }
// });

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

