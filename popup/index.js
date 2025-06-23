"use strict";

const log = getLogger("popup");

const SWITCHES_TO_CONFIG_KEYS = {
    "il-enabled": "www.iltalehti.fi",
    "hs-enabled": "www.hs.fi",
    "yle-enabled": "yle.fi",
    "al-enabled": "www.aamulehti.fi",
};

const CONFIG_KEYS_TO_SWITCHES = Object.fromEntries(
    Object.entries(SWITCHES_TO_CONFIG_KEYS)
        .map(([k, v]) => [v, k])
);

const getCurrentTabHostname = async () => {
    const thisTabInfo = (await browser.tabs
        .query({ active: true, currentWindow: true }))[0];
    const thisTabUrl = new URL(thisTabInfo.url);

    return thisTabUrl.hostname;
};

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
    for (const cb of checkboxes) {
        setCheckBoxReadonly(cb, makeReadonly);
    }
};

/**
 * Store the different views' IDs here in order to make making changes a bit
 * flexibler.
 */
const viewSelectors = {
    "main": ".main-view",
    "rating": "#ratingControls",
    "settings": "#additionalSettings"
};

/**
 * Show this and hide other of the views.
 * @param {*} elemSelector Unique CSS selector string of the view to show.
 */
const showView = (elemSelector) => {
    log(`Showing view '${elemSelector}'`);
    document.querySelector(elemSelector).classList.remove("hidden");

    // Hide all other views.
    for (const viewSelector of Object.values(viewSelectors).filter((x) => x != elemSelector)) {
        const viewElem = document.querySelector(viewSelector);
        viewElem.classList.add("hidden");
    }
};

const handleOpenMain = () => {
    showView(viewSelectors.main);
};

const handleOpenAdditionalSettings = () => {
    showView(viewSelectors.settings);
};

const handleOpenRatingControls = () => {
    showView(viewSelectors.rating);
};

const refreshStatistics = async ({ site, data }) => {
    if (data) {
        document.getElementById("site-host").textContent = site;
        document.getElementById("statistics-main-header").textContent = data["titles"]["pageClickbaitsCount"];
        document.getElementById("statistics-links").textContent = data["misc"]["linksCount"];
    } else {
        document.getElementById("statistics-main-header").textContent = "Tilastoja ei saatavilla. Koeta päivittää ikkuna.";
    }
};

const handleClickConversionSwitch = async (e) => {
    const config = await browser.storage.local.get();
    log("Global config in storage:", config);

    // Update the persistent settings.
    let configUpdateObject;
    if (e.target.id === "extension-enabled") {
        configUpdateObject = { "enabled": e.target.checked };
        // The main switch should toggle if the per-site conversion
        // switches should work or not.
        setCheckboxesReadonly(!e.target.checked);
    } else {
        const switchConfigKey = SWITCHES_TO_CONFIG_KEYS[e.target.id];
        if (switchConfigKey === undefined) {
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

    const pageStatistics = await browser.tabs.sendMessage(activeTabId, {
        command: "convertClickbaits",
    });
    log("Received message to refresh stats with data: ", pageStatistics);
    const thisTabHostname = await getCurrentTabHostname();
    await refreshStatistics({ "site": thisTabHostname, "data": pageStatistics });

};

/////////////////////////
// Define event handlers.

/**
 * Perform initialization when the popup is opened. Load in settings and current
 * page's statistics.
 * @param {*} e 
 */
const handleDomContentLoaded = async (e) => {
    log("Setting up UI");

    // Register button handlers that interact with the popup e.g. turning
    // settings on/off, sending feedback form etc.
    document.getElementById("open-rating").addEventListener("click", handleOpenRatingControls);
    document.getElementById("open-additional-settings").addEventListener("click", handleOpenAdditionalSettings);
    for (const x of document.querySelectorAll(".sub-view-open-main")) {
        // Sub views have a "back" button to switch back to popup main view.
        x.addEventListener("click", handleOpenMain);
    }
    for (const cs of document.querySelectorAll(".conversion-switch")) {
        // Run title-conversion processing always when switches are interacted
        // with.
        cs.addEventListener("click", handleClickConversionSwitch);
    }

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

    const statistics = (await browser.storage.local.get("statistics"))["statistics"];
    log("Full stored statistics: ", statistics);

    const thisTabHostname = await getCurrentTabHostname();
    const thisPageStatistics = statistics?.[thisTabHostname];
    log("This page statistics: ", thisPageStatistics);
    await refreshStatistics({ "site": thisTabHostname, "data": thisPageStatistics });
};

///////////////////////////
// Register event handlers.
document.addEventListener("DOMContentLoaded", handleDomContentLoaded);
