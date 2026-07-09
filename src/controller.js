"use strict";

import { getLogger, browser, getCurrentTabHostname } from "./utils.js";
import { model, modelEvents } from "./model.js";

const log = getLogger("controller");

const _dispatchConversion = async () => {
    log("Dispatching conversion...");
    // Get the active tab.
    const tabs = browser().tabs;
    const activeTabId = (await tabs.query({ active: true, currentWindow: true }))[0].id;
    await tabs.sendMessage(activeTabId, { command: "convertClickbaits" });

    log("Conversion dispatch performed.");
};

const _setSiteEnabled = async (isEnabled, hostname) => {
    if (isEnabled) {
        // Turning on a site also turns on the extension.
        await model.write.setEnabled(true);
    }

    await model.write.setEnabled(isEnabled, hostname);
};

/**
 * Namespace for __controller__ of model-view-controller.
 */
const controller = {
    initialize: async () => {
        console.log("Controller initializing...");
        await model.write.initialize();
        /* CONFIG: Configure your desired development thingies here. */
        if (await model.read.isDevelopmentEnv()) {
            log("Initializing in development mode");
        }
    },

    setEnabled: async (isEnabled) => {
        log("Turning paatti ", isEnabled ? "ON" : "OFF");
        await model.write.setEnabled(isEnabled);
    },

    setEnvironment: async (value) => {
        await model.write.setEnvironment(value);
    },

    setSiteEnabled: _setSiteEnabled,

    dispatchConversion: _dispatchConversion,

    notifyPopupOpened: async () => {
        log("Notifying that popup was opened...");
        // Get the active tab.
        const tabs = browser().tabs;
        const activeTabId = (await tabs.query({ active: true, currentWindow: true }))[0].id;
        await tabs.sendMessage(activeTabId, { command: "popupOpened" });

        log("Popup opened notify performed.");
    },

    updateStatistics: async ({ hostname, siteStats, links }) => {
        model.write.setStatistics(siteStats, { hostname });
    },

    devmode: {
        dumpLinkSignatures: async () => {
            log("Generating dump of link signatures for the current page...");
            // Get the active tab.
            const tabs = browser().tabs;
            const activeTabId = (await tabs.query({ active: true, currentWindow: true }))[0].id;
            const result = await tabs.sendMessage(activeTabId, { command: "devmode_generateLinkSignatures" });

            log("Dumped.");
            return result;
        },

        setTitleDataUrl: async (url) => {
            log("Setting title data URL...");

            const tabs = browser().tabs;
            const activeTabId = (await tabs.query({ active: true, currentWindow: true }))[0].id;

            const currentTabHostname = await getCurrentTabHostname();

            // First restore the original state seen on page so that will not
            // mix the title data sources causing havoc visually.
            const originalEnabledState = await model.read.isEnabled(currentTabHostname);
            await _setSiteEnabled(false, currentTabHostname)
            await tabs.sendMessage(activeTabId, { command: "convertClickbaits" });

            await model.write.setTitleDataUrl(url);
            await tabs.sendMessage(activeTabId, { command: "convertClickbaits" });
            await _setSiteEnabled(originalEnabledState, currentTabHostname)

            log(`Title data URL set to ${url}`);
        },
    },
};

if (browser().tabs) {
    model.events.addEventListener(modelEvents.enabledChange, controller.dispatchConversion);
    model.events.addEventListener(modelEvents.environmentChange, controller.dispatchConversion);
}

export { controller };

