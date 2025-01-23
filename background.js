"use strict";

const log = getLogger("background");

browser.runtime.onInstalled.addListener(async () => {
    // Initialize settings.
    await browser.storage.local.clear();
    await browser.storage.local.set(
        {
            "enabled": true,
            "siteConfigs": {
                "www.iltalehti.fi": {
                    "linkTitleQuerySelector": ".front-title",
                    "enabled": false,
                },
                "www.hs.fi": {
                    "linkTitleQuerySelector": "a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)",
                    "enabled": false,
                },
                "yle.fi": {
                    "enabled": false,
                },
                "www.aamulehti.fi": {
                    "enabled": false,
                },
            }
        }
    );
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

        await browser.tabs.sendMessage(activeTabId, { command: "convertClickbaits" });
    }
});
