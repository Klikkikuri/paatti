"use strict";

const SWITCHES_TO_CONFIG_KEYS = {
    "il-enabled": "www.iltalehti.fi",
    "hs-enabled": "www.hs.fi",
    "yle-enabled": "yle.fi",
    //"al-enabled": null,
};

const log = (...args) => {
    console.log("popup:", ...args);
};

document.addEventListener("click", async (e) => {
    // TODO Explicitly ignore buttons not inside popup?

    // Perform actions according to clicked target.
    switch (e.target.id) {
        case "open-settings":
            const settingsElem = document.querySelector("#settings");
            if (settingsElem
                .classList
                .contains("hidden")
            ) {
                settingsElem.classList.remove("hidden");
            } else {
                settingsElem.classList.add("hidden");
            }
            break;
    }

    // Run processing always when switches are interacted with.
    if (e.target.classList.contains("conversion-switch")) {
        log("Local storage:", await browser.storage.local.get());

        // Update the persistent settings.
        let configUpdateObject;
        if (e.target.id == "extension-enabled") {
            configUpdateObject =  { "enabled": e.target.checked };
        } else {
            const switchConfigKey = SWITCHES_TO_CONFIG_KEYS[e.target.id];
            if (switchConfigKey == undefined) {
                return;
            }
            configUpdateObject = {
                "siteConfigs": {
                    [switchConfigKey]: {
                        "enabled": e.target.checked
                    }
                }
            };
        }

        await browser.storage.local.set(configUpdateObject);

        // Get the active tab.
        const activeTabId = (await browser.tabs
            .query({ active: true, currentWindow: true }))[0].id;

        await browser.tabs.sendMessage(activeTabId, {
            command: e.target.checked
                ? "replaceClickbaits"
                : "restoreClickbaits",
        });
    }
});

document.addEventListener("DOMContentLoaded", async (e) => {
    log("Setting up UI");
    // Load up current settings to UI.
    const isConversionEnabled = (await browser.storage.local.get("enabled"))["enabled"];
    log(isConversionEnabled);
    document.getElementById("extension-enabled").checked = isConversionEnabled;
});
