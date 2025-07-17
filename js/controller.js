"use strict";

/**
 * Namespace for __controller__ of model-view-controller.
 */
const controller = {
    setEnabled: async (isEnabled) => {
        log("Turning paatti ", isEnabled ? "ON" : "OFF");
        await model.setEnabled(isEnabled);
    },

    setCurrentTabEnabled: async (isEnabled) => {
        const currentTabHostname = await getCurrentTabHostname();
        await model.setEnabled(isEnabled, { hostname: currentTabHostname });
    },

    setCurrentTabKerran: async (isKerran) => {
        const currentTabHostname = await getCurrentTabHostname();
        await model.setKerran(isKerran, currentTabHostname);
    },

    runConversion: async () => {
        log("Converting");
        // Get the active tab.
        const activeTabId = (await browser.tabs
            .query({ active: true, currentWindow: true }))[0].id;

        await browser.tabs.sendMessage(activeTabId, { command: "convertClickbaits" });
    },
};