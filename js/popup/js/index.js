"use strict";

///////////////////////////////////////////////////////////////////////////////
// Generic utils and initializer procedures.
///////////////////////////////////////////////////////////////////////////////

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

///////////////////////////////////////////////////////////////////////////////
// Register event handlers. NOTE that the order matters.
///////////////////////////////////////////////////////////////////////////////
// "Main" for when the popup is opened.
document.addEventListener("DOMContentLoaded", view.handleDomContentLoaded);
///////////////////////////////////////////////////////////////////////////////
// Handlers for visual changes like moving between views.
document.getElementById("open-feedbackview")
    .addEventListener("click", () => view.showView("feedback"));
document.getElementById("open-settingsview")
    .addEventListener("click", () => view.showView("settings"));
///////////////////////////////////////////////////////////////////////////////
// Sub views have a "back" button to switch back to popup main view.
for (const backButton of document.querySelectorAll(".sub-view-bottom-navi > .sub-view-transition")) {
    backButton.addEventListener("click", () => view.showView("main"));
}
///////////////////////////////////////////////////////////////////////////////
// Handlers for application state changes.
document.getElementById("extension-disabled-temporarily")
    .addEventListener("click", view.handleClickKerran);
document.getElementById("shortcut-extension-enabled-current-site")
    .addEventListener("click", view.handleClickAina);
// Register main of/off switch.
document.getElementById("extension-enabled")
    .addEventListener("click", view.handleClickMainSwitch);
// Register site switches under settings view.
for (const pageEnabledSwitch of document.querySelectorAll(".settingsview .conversion-switch")) {
    pageEnabledSwitch.addEventListener("click", view.handleClickConversionSwitch);
}

///////////////////////////////////////////////////////////////////////////////
// "We have events at home."
///////////////////////////////////////////////////////////////////////////////

model.addEventListener(modelEvents.enabledChange, view.refresh);
model.addEventListener(modelEvents.statisticsChange, view.refresh);