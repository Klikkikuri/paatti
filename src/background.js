"use strict";

import { browser, getLogger } from "./utils.js";
import { getConfig } from "./config.js";
import { fetchRahtiData } from "./rahti.js";

const log = getLogger("background");

const DEFAULT_ENVIRONMENT = "free";


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

    log(`Setting up periodic Rahti data fetch every ${intervalMinutes} minutes.`);

    setInterval(fetchRahtiData, intervalMinutes * 60 * 1000);
});
