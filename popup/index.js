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

let _currentTabHostname;
const setGlobalCurrentTabHostname = async () => {
    const thisTabInfo = (await browser.tabs
        .query({ active: true, currentWindow: true }))[0];
    const thisTabUrl = new URL(thisTabInfo.url);

    _currentTabHostname = thisTabUrl.hostname;
};
const getCurrentTabHostname = async () => {
    return _currentTabHostname;
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
    "main": [".site-details", ".bottom-navi"],
    "rating": [".rating-controls-header", ".rating-controls", ".sub-view-bottom-navi"],
    "settings": [".additional-settings-header", ".additional-settings", ".sub-view-bottom-navi"],
};

/**
 * Show this and hide other of the views.
 * @param {*} viewName Identifier of the view to show.
 */
const showView = (viewName) => {
    log(`Showing view '${viewName}'`);

    // Hide all views.
    for (const name of Object.keys(viewSelectors)) {
        for (const elemSelector of viewSelectors[name]) {
            document.querySelector(elemSelector).classList.add("hidden");
        }
    }
    // Show the selected view.
    for (const elemSelector of viewSelectors[viewName]) {
        document.querySelector(elemSelector).classList.remove("hidden");
    }
};

const handleOpenMain = () => {
    showView("main");
};

const handleOpenAdditionalSettings = () => {
    showView("settings");
};

const handleOpenRatingControls = () => {
    showView("rating");
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

    await runConversion();

};

const runConversion = async () => {
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

/**
 * Register button handlers that interact with the popup visuals e.g. open the
 * settings page page etc.  
 */
const addUiEventListeners = () => {
    document.getElementById("open-rating").addEventListener("click", handleOpenRatingControls);
    document.getElementById("open-additional-settings").addEventListener("click", handleOpenAdditionalSettings);
    for (const x of document.querySelectorAll(".sub-view-bottom-navi > .sub-view-transition")) {
        // Sub views have a "back" button to switch back to popup main view.
        x.addEventListener("click", handleOpenMain);
    }
};

/**
 * Register button handlers that change the current state of the extension like
 * settings etc.
 */
const addOtherEventListeners = () => {
    document.getElementById("extension-disabled-temporarily")
        .addEventListener("click", async (e) => {
            const config = await browser.storage.local.get();
            const configUpdateObject = config;
            const currentTabHostname = await getCurrentTabHostname();
            config["siteConfigs"][currentTabHostname]["enabled"] = !e.target.checked;
            config["siteConfigs"][currentTabHostname]["kerran"] = e.target.checked;
            await browser.storage.local.set(configUpdateObject);

            // Run the conversion subroutine to match view to the changed settings.
            await runConversion();
        });

    // Register button handlers that change settings.
    for (const cs of document.querySelectorAll(".conversion-switch")) {
        // Run title-conversion processing always when switches are interacted
        // with.
        cs.addEventListener("click", handleClickConversionSwitch);
    }
};

/**
 * Perform initialization when the popup is opened. Load in settings and current
 * page's statistics.
 * @param {*} e 
 */
const handleDomContentLoaded = async (e) => {
    log("Setting up UI");

    // Initialize the flobal hostname variable as that's how the Javascript
    // cookie seems to crumble.
    await setGlobalCurrentTabHostname();

    // Set view height to the dimensions found when opened the popup so that the
    // view does not jump around when navigating but keeps (I hope) the view
    // responsive in different windows.
    document.querySelector("body").style.height = `${document.querySelector("body").clientHeight + 38}px`;


    addUiEventListeners();
    addOtherEventListeners();

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
        if (k === await getCurrentTabHostname()) {
            document.getElementById("extension-disabled-temporarily").checked = v["kerran"];

        }
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
