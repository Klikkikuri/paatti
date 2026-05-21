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
        { "content": ".main-content", "naviItem": "#navi-main" },
    "feedback":
        { "content": ".feedbackview", "naviItem": "#navi-feedback" },
    "settings":
        { "content": ".settingsview", "naviItem": "#navi-feedback" },
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

const _refreshContentView = ({ site, data, isEnabled }) => {
    const contentElem = document.getElementById("statsview")
    const errorElem = document.getElementById("statserror");

    // Hide all elements.
    contentElem.classList.add("hidden");
    errorElem.classList.add("hidden");

    // Show appropriate elements.
    if (data) {
        contentElem.classList.remove("hidden");

        document.getElementById("site-host").textContent = site;

        document.querySelector("#statistics-grouped-by-clickbaitiness tfoot td").textContent
            = Object.values(data.groupedByClickbaitiness).reduce((acc, x) => acc + x, 0);
        
        const clickbaitinessTableBody = document.querySelector("#statistics-grouped-by-clickbaitiness tbody");
        while (clickbaitinessTableBody.firstChild) {
            clickbaitinessTableBody.removeChild(clickbaitinessTableBody.firstChild);
        }
        for (const [clickbaitiness, amount] of Object.entries(data.groupedByClickbaitiness)) {
            const tr = document.createElement("tr");
            const th = document.createElement("th");
            th.scope = "row";
            th.textContent = browser().i18n.getMessage(`clickbaitinessLabel ${clickbaitiness}`);
            const td = document.createElement("td");
            td.textContent = amount;
            tr.appendChild(th);
            tr.appendChild(td);
            clickbaitinessTableBody.appendChild(tr);
        }
    } else {
        errorElem.classList.remove("hidden");

        // Generic error.
        document.getElementById("site-host").textContent = browser().i18n.getMessage("siteTitleNotSupported");

        if (site) {
            // Show instructions if there was some problem loading the data on a supported site.
            errorElem.querySelector("p").textContent = browser().i18n.getMessage("statsErrorUserFixInstructions");
        }
    }

    document.getElementById("statsview-header").textContent =
        browser().i18n.getMessage("statsviewHeader");
    const statisticsGroupedByClickbaitinessTableHeaders =
        document.querySelectorAll("#statistics-grouped-by-clickbaitiness thead th");
    statisticsGroupedByClickbaitinessTableHeaders[0].textContent =
        browser().i18n.getMessage("statsviewGroupedByClickbaitinessLabelClickbaitiness");
    statisticsGroupedByClickbaitinessTableHeaders[1].textContent =
        browser().i18n.getMessage("statsviewGroupedByClickbaitinessLabelAmount");
    document.querySelector("#statistics-grouped-by-clickbaitiness tfoot th").textContent =
        browser().i18n.getMessage("statsviewGroupedByClickbaitinessLabelTotal");
};

const _refreshSettingsView = ({ isConversionEnabled, sitesEnabled, titleDataUrlSelected, isDevelopmentEnv, testTitleDataUrl, config }) => {

    // First reset the view, as rahti-fetch alarm will keep re-adding enabled
    // sites to their list in UI.
    const sitesEnabledList = document.getElementById("sites-enabled-ul");
    while (sitesEnabledList.firstChild) {
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
    } else {
        document.querySelectorAll(".devmode").forEach((x) => x.classList.add("hidden"));
        document.querySelector("#logo img").classList.remove("hidden");
    }

    document.getElementById("settingsview-sites-enabled-title").textContent =
        browser().i18n.getMessage("settingsviewSitesEnabledTitle");
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

/**
 * Show this and hide other of the views.
 * @param {*} viewName Identifier of the view to show.
 */
const showView = (viewName) => {
    log(`Showing view '${viewName}'`);

    // Hide all views and reset states.
    for (const viewObj of Object.values(_viewSelectors)) {
        document.querySelector(viewObj["content"]).classList.add("hidden");
    }
    // Show the selected view.
    document.querySelector(_viewSelectors[viewName]["content"]).classList.remove("hidden");
};

/**
 * Load up current settings to UI.
 */
const refresh = async () => {
    const isConversionEnabled = await model.read.isEnabled();
    const pageHostname = await getCurrentTabHostname();
    const pageStatistics = await model.read.getStatistics(pageHostname);
    const sitesEnabled = await model.read.getSitesEnabled();
    const titleDataUrlSelected = await model.read.getTitleDataUrls();
    const isDevelopmentEnv = await model.read.isDevelopmentEnv();
    const testTitleDataUrl = await model.read.getTestTitleDataUrl();
    const config = await getConfig();

    // Update the power button.
    document.getElementById("extension-enabled").checked = isConversionEnabled;

    _refreshSettingsView({
        isConversionEnabled,
        sitesEnabled,
        titleDataUrlSelected,
        isDevelopmentEnv,
        testTitleDataUrl,
        config,
    });
    _refreshContentView({
        site: pageHostname,
        data: pageStatistics,
        isEnabled: sitesEnabled[pageHostname],
    });

    // Rest of localizations.
    document.getElementById("feedbackview-general-feedback").querySelector("iframe").textContent =
        browser().i18n.getMessage("feedbackviewGeneralFeedbackLoading");
    document.getElementById("feedbackview-general-feedback-header").textContent =
        browser().i18n.getMessage("feedbackviewGeneralFeedbackHeader");

    /*
     * TODO: Implement converted vs. original title rating.
    document.getElementById("feedbackview-rate-title-header").textContent =
        browser().i18n.getMessage("feedbackviewRateTitleHeader");
    document.getElementById("feedbackview-rate-title").querySelector("p strong:first-child").textContent =
        browser().i18n.getMessage("feedbackviewRateTitleOriginalTitleLabel");
    document.getElementById("feedbackview-rate-title").querySelector("p strong:nth-child(1)").textContent =
        browser().i18n.getMessage("feedbackviewRateTitleConvertedTitleLabel");
    document.getElementById("feedbackview-rate-title").querySelector("p strong:nth-child(1)").textContent =
        browser().i18n.getMessage("feedbackviewRateTitleConvertedTitleLabel");
    document.querySelector("label[for=good]").textContent =
        browser().i18n.getMessage("feedbackviewRateTitleConversionIsGood");
    document.querySelector("label[for=bad]").textContent =
        browser().i18n.getMessage("feedbackviewRateTitleConversionIsBad");
    */

    document.getElementById("navi-main").parentElement.title =
        browser().i18n.getMessage("navigationMainLabel");
    document.getElementById("navi-feedback").parentElement.title =
        browser().i18n.getMessage("navigationFeedbackLabel");
    document.getElementById("navi-settings").parentElement.title =
        browser().i18n.getMessage("navigationSettingsLabel");

    document.querySelector("label[for=enable-devmode] span").title =
        browser().i18n.getMessage("devmodeHiddenButtonTitle");

    // Inform content script that the popup is opened.
    await controller.notifyPopupOpened();
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

const __devmodeEnable = async () => {
    await controller.setEnvironment(
        await model.read.isDevelopmentEnv() ? "production" : "development"
    );
};

/**
 * Namespace for _controller_ of model-view-controller.
 */
const view = {
    handleDomContentLoaded: handleDomContentLoaded,
    showView: showView,
    handleClickMainSwitch: handleClickMainSwitch,

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

// Register main of/off switch.
document.getElementById("extension-enabled")
    .addEventListener("click", view.handleClickMainSwitch);
// Register site switches under settings view.
for (const pageEnabledSwitch of document.querySelectorAll(".settingsview .conversion-switch")) {
    pageEnabledSwitch.addEventListener("click", view.handleClickConversionSwitch);
}

///////////////////////////////////////////////////////////////////////////////
// Handlers for devmode utils.
document.getElementById("enable-devmode")
    .addEventListener("click", __devmodeEnable);

///////////////////////////////////////////////////////////////////////////////
// Handlers related to other non-popup-parts of the extension.
browser().runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.message) {
        case "isPopupOpen":
            sendResponse({ "isOpen": true });
            break;
        default:
            log("Unknown message: ", message);
    }
});

///////////////////////////////////////////////////////////////////////////////
// "We have events at home."
///////////////////////////////////////////////////////////////////////////////

model.events.addEventListener(modelEvents.enabledChange, view.refresh);
// TODO: Maybe refactor this to abstract local storage away (or don't, wtfgas).
browser().storage.local.onChanged.addListener(view.refresh);

