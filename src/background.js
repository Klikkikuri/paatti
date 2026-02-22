"use strict";

import { browser, getLogger } from "./utils.js";
import { getConfig } from "./config.js";
import { fetchRahtiData } from "./rahti.js";
import { initSuola } from "../suola/build/suola.js";

const log = getLogger("background");

/*
 * README:
 *
 * This file/module depends on the following functions in its global scope:
 * - `hashUrl(url: string) -> string | falsy`
 *   - Function should normalize and return a sha256 hash of the input URL or a
 *   falsy value in case of an error.
 * - `initSuola(url: string) -> void`
 *   - Function should make the hashUrl-function available based on the
 *   provided URL/path of the WebAssembly module (browser extension accesses
 *   the .wasm file differently compared to normal browser scripts/files).
 *
 * The WebAssembly module is loaded and initialized in the background because
 * loading it in content script would add about 500ms delay to starting the
 * processing.
 */

try {
    await initSuola(browser().runtime.getURL("suola/build/js.wasm"));

    // Start listening for content script requests that request suola.
    browser().runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        switch (request.message.command) {
            case "hashUrl":
                // Send the compiled Module (can be transferred to content scripts)
                const hash = await hashUrl(request.message.url);
                log(hash);
                return hash;
            default:
                log("Unknown message:", message);
                break;
        }
    });
} catch (e) {
    // TODO: Try a couple times and eventually set some error state for GUI.
    log("Paatti sailing in fresh water :/ ", e);
}

////////////////////////////////////////////////////////////////////////////////

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

