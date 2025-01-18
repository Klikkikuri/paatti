"use strict";

const log = (...args) => {
    console.log("background:", ...args);
};


browser.runtime.onInstalled.addListener(async () => {
    // Initialize settings.
    await browser.storage.local.clear();
    await browser.storage.local.set({ "enabled": true });
    log("Loaded");
});

// For every site load, perform the conversion as configured.
browser.tabs.onUpdated.addListener(async () => {
    log("Tab updated");
    const doConvert = (await browser.storage.local
        .get("enabled"))["enabled"];
    if (doConvert) {
        log("Converting");
        // Get the active tab.
        const activeTabId = (await browser.tabs
            .query({ active: true, currentWindow: true }))[0].id;

        await browser.tabs.sendMessage(activeTabId, { command: "replaceClickbaits" });
    }
});
