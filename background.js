"use strict";

const log = getLogger("background");

browser.runtime.onInstalled.addListener(async () => {
    // Initialize settings.
    await browser.storage.local.clear();
    const config = {
        // CONFIG: Configure extension to start enabled here.
        "enabled": true,
        // CONFIG: Configure per-site settings here.
        "siteConfigs": {
            "www.iltalehti.fi": {
                "linkTitleQuerySelectors": [
                    ".front-title",
                    ".title-container,.title-container-most-read > .title",
                    ".newsticker-title-text",
                    ".latest-pala-video-overlay > .latest-pala-title"
                ],
                "enabled": false,
            },
            "www.hs.fi": {
                "linkTitleQuerySelectors": [
                    "a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)",
                ],
                "enabled": false,
            },
            "yle.fi": {
                "enabled": false,
            },
            "www.aamulehti.fi": {
                "enabled": false,
            },
        },
        "environmentConfigs": {
            /* CONFIG: Un/comment these values to set dev mode on or off. */
            //"environment": "production",
            "environment": "development",
        },
        // TODO: Initialize stats object here but might not find under "configs" perse.
        "statistics": {},
    };

    /* CONFIG: Configure your desired development thingies here. */
    if (config["environmentConfigs"]["environment"] === "development") {
        config["siteConfigs"]["www.iltalehti.fi"]["enabled"] = true;
    }


    await browser.storage.local.set(config);

    log("Installed Paatti with initial configuration:", config);
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
