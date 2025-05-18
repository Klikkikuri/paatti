"use strict";

const log = getLogger("popup");

const SWITCHES_TO_CONFIG_KEYS = {
    "il-enabled":  "www.iltalehti.fi",
    "hs-enabled":  "www.hs.fi",
    "yle-enabled": "yle.fi",
    "al-enabled":  "www.aamulehti.fi",
};

const CONFIG_KEYS_TO_SWITCHES = Object.fromEntries(
    Object.entries(SWITCHES_TO_CONFIG_KEYS)
        .map(([k, v]) => [v, k])
);

const setCheckBoxReadonly = (checkbox, makeReadonly) => {
    if (makeReadonly) {
        checkbox.classList.add("toggle-readonly");
    } else {
        checkbox.classList.remove("toggle-readonly");
    }
};

/* Set the visual readonly state of checkboxes under settings */
const setCheckboxesReadonly = (makeReadonly) => {
    const checkboxes = document.querySelectorAll("#settings .conversion-switch");
    log(checkboxes);
    for (const x of checkboxes) {
        setCheckBoxReadonly(x, makeReadonly);
    }
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
        const config = await browser.storage.local.get();
        log("Local storage:", config);

        // Update the persistent settings.
        let configUpdateObject;
        if (e.target.id === "extension-enabled") {
            configUpdateObject =  { "enabled": e.target.checked };
            // The main switch should toggle if the per-site conversion
            // switches should work or not.
            setCheckboxesReadonly(!e.target.checked);
        } else {
            const switchConfigKey = SWITCHES_TO_CONFIG_KEYS[e.target.id];
            if (switchConfigKey == undefined) {
                return;
            }
            // Replace the old config with a new one entirely.
            configUpdateObject = config;
            configUpdateObject["siteConfigs"][switchConfigKey]["enabled"] = e.target.checked;
            if (configUpdateObject["siteConfigs"][switchConfigKey]["enabled"]) {
                // Turning on one site turns on the extension also.
                configUpdateObject["enabled"] = true;
                // Make the visual changes as the extension should now be enabled.
                setCheckboxesReadonly(false);
                const mainSwitch = document.getElementById("extension-enabled");
                setCheckBoxReadonly(mainSwitch, false);
                mainSwitch.checked = true;
            }
        }

        await browser.storage.local.set(configUpdateObject);

        // Get the active tab.
        const activeTabId = (await browser.tabs
            .query({ active: true, currentWindow: true }))[0].id;

        await browser.tabs.sendMessage(activeTabId, {
            command: "convertClickbaits",
        });
    }
});

document.addEventListener("DOMContentLoaded", async (e) => {
    log("Setting up UI");
    // Load up current settings to UI.
    const isConversionEnabled = (await browser.storage.local.get("enabled"))["enabled"];
    log(isConversionEnabled);
    document.getElementById("extension-enabled").checked = isConversionEnabled;


    // Visualize per site switches as "readonly" as per main switch state.
    setCheckboxesReadonly(!isConversionEnabled);
    // Set their enabled state based on the stored value.
    const siteConfigs = (await browser.storage.local.get("siteConfigs"))["siteConfigs"];
    for (const [k, v] of Object.entries(siteConfigs)) {
        document.getElementById(CONFIG_KEYS_TO_SWITCHES[k]).checked = v["enabled"];
    }
});
