"use strict";

import { getLogger, browser, getCurrentTabHostname } from "../utils.js";
import { model, modelEvents } from "../model.js";
import { controller } from "../controller.js";
import { getConfig } from "../config.js";

const log = getLogger("view");

///////////////////////////////////////////////////////////////////////////////
// Helper procedures and definitions.
///////////////////////////////////////////////////////////////////////////////

const getSitesEnabledItemId = (host) => `${host}-enabled`;

/**
 * Store the different views' IDs here in order to make making changes a bit
 * flexibler.
 */
const _viewSelectors = {
    "main":
        { "content": ".main-content", "naviItem": ".open-home" },
    "feedback":
        { "content": ".feedbackview", "naviItem": ".open-feedbackview" },
    "settings":
        { "content": ".settingsview", "naviItem": ".open-settingsview" },
};

const _setCheckBoxReadonly = (checkbox, makeReadonly) => {
    if (makeReadonly) {
        checkbox.classList.add("toggle-readonly");
    } else {
        checkbox.classList.remove("toggle-readonly");
    }
};

/* Set the visual readonly state of checkboxes under settings */
const _setSettingsviewCheckboxesReadonly = (isConversionEnabled) => {
    const checkboxes = document.querySelectorAll(".settingsview .conversion-switch");
    const makeReadonly = !isConversionEnabled;
    for (const cb of checkboxes) {
        _setCheckBoxReadonly(cb, makeReadonly);
    }
};

const _refreshStatistics = ({ site, data }) => {
    const contentElem = document.getElementById("statsview")
    const errorElem = document.getElementById("statserror");

    // Hide all elements.
    contentElem.classList.add("hidden");
    errorElem.classList.add("hidden");

    // Show appropriate elements.
    if (data) {
        contentElem.classList.remove("hidden");

        document.getElementById("site-host").textContent = site;
        document.getElementById("statistics-main-header").textContent
            = data["titles"]["convertedTitlesCount"];
        // TODO: This seems like it's not that interesting for the user...
        //document.getElementById("statistics-links").textContent
        //    = data["misc"]["linksCount"];
    } else if (site) {
        contentElem.classList.remove("hidden");

        document.getElementById("site-host").textContent = "Sivusto ei tuettu";
    } else {
        errorElem.classList.remove("hidden");

        document.getElementById("site-host").textContent = "Karilla!";
        errorElem.querySelector("p").textContent
            = "Sivun tietoja ei saatu ladattua. Koeta päivittää ikkuna.";
    }
};

const _refreshSettingsView = ({isConversionEnabled, sitesEnabled, isDebugVisualsEnabled, titleDataUrlSelected, isDevelopmentEnv, testTitleDataUrl, config}) => {

    // First reset the view, as rahti-fetch alarm will keep re-adding enabled
    // sites to their list in UI.
    const sitesEnabledList = document.getElementById("sites-enabled-ul");
    while (sitesEnabledList.firstChild)  {
        sitesEnabledList.removeChild(sitesEnabledList.firstChild);
    }

    // Add the supported sites' listing to UI.
    for (const [host, site] of Object.entries(config.siteConfigs)) {
        const input = document.createElement("input");
        input.classList.add("toggle");
        input.classList.add("conversion-switch");
        input.id = getSitesEnabledItemId(host);
        input.type = "checkbox";
        const label = document.createElement("label");
        label.for = input.id;
        label.textContent = site.name;
        const item = document.createElement("li");
        item.appendChild(label);
        item.appendChild(input);
        sitesEnabledList.appendChild(item);
    }


    // Visualize per site switches as "readonly" as per main switch state.
    _setSettingsviewCheckboxesReadonly(isConversionEnabled);

    // Set the per site switches enabled as per their switch state.
    for (const [hostname, isEnabled] of Object.entries(sitesEnabled)) {
        const siteSwitch = document.getElementById(getSitesEnabledItemId(hostname));
        if (siteSwitch === null) {
            throw `Conversion switch element not found for hostname '${hostname}'`;
        }
        siteSwitch.checked = isEnabled;
    }

    if (isDevelopmentEnv) {
        document.querySelectorAll(".devmode").forEach((x) => x.classList.remove("hidden"));
        document.querySelector("#logo img").classList.add("hidden");

        const titleDataUrlSelect = document.getElementById("devmode-setTitleDataUrl");
        if (!titleDataUrlSelect.querySelectorAll("option").values().find((x) => x.value === testTitleDataUrl)) {
            const option = document.createElement("option");
            option.textContent = "Paatti test data";
            option.value = testTitleDataUrl;
            titleDataUrlSelect.appendChild(option);
        }
    } else {
        document.querySelectorAll(".devmode").forEach((x) => x.classList.add("hidden"));
        document.querySelector("#logo img").classList.remove("hidden");
    }

    document.getElementById("devmode-setDebugVisuals")
        .checked = isDebugVisualsEnabled;

    for (const option of document.getElementById("devmode-setTitleDataUrl").querySelectorAll("option")) {
        option.selected = false;
        if (option.value === titleDataUrlSelected) {
            option.selected = true;
        }
    }
};

const _refreshContentView = ({ pageHostname, pageStatistics, isEnabled }) => {
    _refreshStatistics({ site: pageHostname, data: pageStatistics });

    document.getElementById("shortcut-extension-enabled-current-site").checked = !(isEnabled);
};

///////////////////////////////////////////////////////////////////////////////
// Adapters that use the controller but also trigger other business logic
// procedures.
///////////////////////////////////////////////////////////////////////////////

const handleClickMainSwitch = async (e) => {
    await controller.setEnabled(e.target.checked);
};

const handleClickConversionSwitch = async (e) => {
    // Update the persistent settings.
    const hostname = SWITCHES_TO_CONFIG_KEYS[e.target.id];
    if (hostname === undefined) {
        log("Conversion switch handler registered to unknown hostname:", hostname);
        return;
    }

    await controller.setSiteEnabled(e.target.checked, hostname);
};


const handleClickAina = async (e) => {
    await controller.setCurrentTabEnabled(!e.target.checked);
};

/**
 * Show this and hide other of the views.
 * @param {*} viewName Identifier of the view to show.
 */
const showView = (viewName) => {
    log(`Showing view '${viewName}'`);

    // Hide all views and reset states.
    for (const viewObj of Object.values(_viewSelectors)) {
        document.querySelector(viewObj["content"]).classList.add("hidden");
        document.querySelector(viewObj["naviItem"]).classList.remove("navi-selected");
    }
    // Show the selected view.
    document.querySelector(_viewSelectors[viewName]["content"]).classList.remove("hidden");
    document.querySelector(_viewSelectors[viewName]["naviItem"]).classList.add("navi-selected");
};

/**
 * Load up current settings to UI.
 */
const refresh = async () => {
    const isConversionEnabled = await model.read.isEnabled();
    const pageHostname = await getCurrentTabHostname();
    const pageStatistics = await model.read.getStatistics(pageHostname);
    const sitesEnabled = await model.read.getSitesEnabled();
    const isDebugVisualsEnabled = await model.read.getDebugVisualsEnabled();
    const titleDataUrlSelected = await model.read.getTitleDataUrl();
    const isDevelopmentEnv = await model.read.isDevelopmentEnv();
    const testTitleDataUrl = await model.read.getTestTitleDataUrl();
    const config = await getConfig();

    // Update the power button.
    document.getElementById("extension-enabled").checked = isConversionEnabled;

    _refreshSettingsView({
        isConversionEnabled,
        sitesEnabled,
        isDebugVisualsEnabled,
        titleDataUrlSelected,
        isDevelopmentEnv,
        testTitleDataUrl,
        config,
    });
    _refreshContentView({
        pageHostname,
        pageStatistics,
        isEnabled: sitesEnabled[pageHostname],
    });
};

/**
 * Perform initialization when the popup is opened. Load in settings and current
 * page's statistics.
 * @param {*} e 
 */
const handleDomContentLoaded = async (e) => {
    log("Setting up UI");

    await refresh();

    // Set view height to the dimensions found when opened the popup so that the
    // view does not jump around when navigating but keeps (I hope) the view
    // responsive in different windows.
    // FIXME: If height is not "max" at start (like an error message makes the
    // vertical length shorter than the length in normal state), the following
    // normal state gets a vertical scrollbar. Maybe take max of current and run
    // this again on refreshes?
    document.querySelector("body").style.height = `${document.querySelector("body").clientHeight + 38}px`;
};

const __devmodeShowControls = async () => {
    await controller.setEnvironment(
        await model.read.isDevelopmentEnv() ? "production" : "development"
    );
};

const __devmode_dumpLinkHash = async (e) => {
    const pageSignatures = await controller.devmode.dumpLinkHash();
    log(pageSignatures);
    const pageSignaturesDump = pageSignatures
        .filter((x) => x !== null)
        .map((x) => x.toString())
        .join("\n");
    await window.navigator.clipboard.write([new ClipboardItem({"text/plain": pageSignaturesDump})]);

    e.target.disabled = true;
    const eventTargetLabel = document.querySelector(`label[for=${e.target.id}]`);
    const textContentTemp = eventTargetLabel.textContent;
    eventTargetLabel.textContent = "Linkkitiivisteet kopioitu leikepöydälle!";
    setTimeout(() => {
        eventTargetLabel.textContent = textContentTemp;
        e.target.disabled = false;
    }, 3000);
};

const __devmode_setDebugVisuals = async (e) => {
    await controller.devmode.setDebugVisuals(e.target.checked);
};

const __devmode_setTitleDataUrl = async (e) => {
    await controller.devmode.setTitleDataUrl(e.target.value);
};

/**
 * Namespace for _controller_ of model-view-controller.
 */
const view = {
    handleDomContentLoaded: handleDomContentLoaded,
    showView: showView,
    handleClickMainSwitch: handleClickMainSwitch,

    handleClickAina: handleClickAina,
    handleClickConversionSwitch: handleClickConversionSwitch,
    refresh: refresh,
};

///////////////////////////////////////////////////////////////////////////////
// Register event handlers. NOTE that the order matters.
///////////////////////////////////////////////////////////////////////////////
// "Main" for when the popup is opened.
document.addEventListener("DOMContentLoaded", view.handleDomContentLoaded);
///////////////////////////////////////////////////////////////////////////////
// Handlers for visual changes like moving between views.
document.querySelector(".open-feedbackview")
    .addEventListener("click", () => view.showView("feedback"));
document.querySelector(".open-settingsview")
    .addEventListener("click", () => view.showView("settings"));
document.querySelector(".open-home")
    .addEventListener("click", () => view.showView("main"));
///////////////////////////////////////////////////////////////////////////////
// Handlers for application state changes.

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
// Handlers for devmode utils.
document.getElementById("show-devmode-controls")
    .addEventListener("click", __devmodeShowControls);
document.getElementById("devmode-dumpLinkHash")
    .addEventListener("click", __devmode_dumpLinkHash);
document.getElementById("devmode-setDebugVisuals")
    .addEventListener("click", __devmode_setDebugVisuals);
document.getElementById("devmode-setTitleDataUrl")
    .addEventListener("change", __devmode_setTitleDataUrl);

///////////////////////////////////////////////////////////////////////////////
// "We have events at home."
///////////////////////////////////////////////////////////////////////////////

model.events.addEventListener(modelEvents.enabledChange, view.refresh);
// TODO: Maybe refactor this to abstract local storage away (or don't, wtfgas).
browser().storage.local.onChanged.addListener(view.refresh);

