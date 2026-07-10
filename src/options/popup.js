"use strict";

import { getLogger, browser, getCurrentTabHostname } from "../utils.js";
import { model, modelEvents } from "../model.js";
import { controller } from "../controller.js";
import { getConfig } from "../config.js";
import { displayProductInfo, getClickbaitLevelInfo } from "./utils.js";

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

const _refreshContentView = ({ site, data, isSiteEnabled }) => {
    const siteHeaderElem = document.getElementById("site-host");
    // Reset possible error state.
    siteHeaderElem.classList.remove("error");

    // Show appropriate elements and handle errors.
    if (isSiteEnabled === undefined) {
        siteHeaderElem.classList.add("error");

        siteHeaderElem.textContent = browser().i18n.getMessage("siteTitleProcessingNotSupported");
    } else if (!isSiteEnabled) {
        siteHeaderElem.classList.add("error");

        siteHeaderElem.textContent = browser().i18n.getMessage("siteTitleProcessingDisabled");
    } else if (Object.keys(data || {}).length === 0) {
        siteHeaderElem.classList.add("error");

        siteHeaderElem.textContent = browser().i18n.getMessage("statsErrorUserFixInstructions");
    } else {
        // Display that this site is supported and processed.
        document.getElementById("site-host").textContent = site;
    }

    const statsTableData =  (data || {}).groupedByClickbaitiness || {};
    // Display total amount of found titles on this page.
    const table = document.getElementById("statistics-grouped-by-clickbaitiness");
    table.querySelector("tfoot td").textContent = Object.values(statsTableData).reduce((acc, x) => acc + x, 0);

    // The static HTML table has the row elements sorted by clickbaitiness level.
    const clickbaitinessTableRows = table.querySelector("tbody").children;

    for (const row of clickbaitinessTableRows) {
        const levelI8nKey = row.id.replaceAll("-", " ");
        const levelKey = levelI8nKey.split("clickbaitinessLabel ")[1];
        row.querySelector("th").textContent = browser().i18n.getMessage(levelI8nKey);
        row.querySelector("td").textContent = statsTableData[levelKey] || 0;
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

const _refreshSettingsView = ({ isConversionEnabled, sitesEnabled, titleDataUrlSelected, isDevelopmentEnv, testTitleDataUrl, config, visualHighlightEnabled }) => {

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
        input.dataset.hostname = host;
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

        // Set devmode debug visuals checkbox state
        const debugVisualsCheckbox = document.getElementById("devmode-setDebugVisuals");
        if (debugVisualsCheckbox) {
            debugVisualsCheckbox.checked = !!visualHighlightEnabled;
        }

        // Set devmode title data url selection options and active value
        const titleDataUrlSelect = document.getElementById("devmode-setTitleDataUrl");
        if (titleDataUrlSelect) {
            titleDataUrlSelect.innerHTML = "";
            const envUrls = config.environmentConfigs?.development?.titleDataUrls || [];
            for (const url of envUrls) {
                const opt = document.createElement("option");
                opt.value = url;
                try {
                    const parsed = new URL(url);
                    opt.textContent = parsed.hostname + parsed.pathname;
                } catch(e) {
                    opt.textContent = url;
                }
                titleDataUrlSelect.appendChild(opt);
            }
            if (titleDataUrlSelected && titleDataUrlSelected.length > 0) {
                titleDataUrlSelect.value = titleDataUrlSelected[0];
            }
        }
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
    await controller.setSiteEnabled(e.target.checked, e.target.dataset.hostname);
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
    const storageData = await browser().storage.local.get("visualHighlightEnabled");
    const visualHighlightEnabled = storageData.hasOwnProperty("visualHighlightEnabled")
        ? !!storageData.visualHighlightEnabled
        : config.debugVisualsEnabled;


    // Update the power button to imply site status.
    const matchingDomain = await model.read.getMatchingSiteDomain(pageHostname);
    const isCurrentSiteEnabled = matchingDomain ? (sitesEnabled[matchingDomain] || false) : false;
    const isSiteSupported = matchingDomain !== null;
    const powerCheckbox = document.getElementById("extension-enabled");
    if (powerCheckbox) {
        powerCheckbox.checked = isCurrentSiteEnabled;
        powerCheckbox.disabled = !isSiteSupported;
        powerCheckbox.dataset.hostname = matchingDomain || pageHostname;
    }

    const powerLabel = document.querySelector("label[for=extension-enabled]");
    if (powerLabel) {
        if (!isSiteSupported) {
            powerLabel.style.opacity = "0.5";
            powerLabel.style.cursor = "not-allowed";
        } else {
            powerLabel.style.opacity = "1.0";
            powerLabel.style.cursor = "pointer";
        }
    }

    // Update settings view master switch
    const settingsviewStatusTitle = document.getElementById("settingsview-status-title");
    if (settingsviewStatusTitle) {
        settingsviewStatusTitle.textContent = browser().i18n.getMessage("settingsviewStatusTitle");
    }
    const settingsviewMasterSwitchLabel = document.getElementById("settingsview-master-switch-label");
    if (settingsviewMasterSwitchLabel) {
        settingsviewMasterSwitchLabel.textContent = browser().i18n.getMessage("settingsviewMasterSwitchLabel");
    }
    const settingsviewExtensionEnabled = document.getElementById("settingsview-extension-enabled");
    if (settingsviewExtensionEnabled) {
        settingsviewExtensionEnabled.checked = isConversionEnabled;
    }

    // Update settings view clickbait level section
    const settingsviewClickbaitLevelTitle = document.getElementById("settingsview-clickbait-level-title");
    if (settingsviewClickbaitLevelTitle) {
        settingsviewClickbaitLevelTitle.textContent = browser().i18n.getMessage("settingsviewClickbaitLevelTitle");
    }
    const clickbaitLevel = await model.read.getClickbaitLevel();
    const clickbaitLevelInput = document.getElementById("settingsview-clickbait-level");
    if (clickbaitLevelInput) {
        clickbaitLevelInput.value = clickbaitLevel;
        const levelInfo = getClickbaitLevelInfo(clickbaitLevel);
        const clickbaitLevelLabel = document.getElementById("settingsview-clickbait-level-label");
        if (clickbaitLevelLabel) {
            clickbaitLevelLabel.textContent = levelInfo.title;
        }
        const clickbaitLevelDesc = document.getElementById("settingsview-clickbait-level-description");
        if (clickbaitLevelDesc) {
            clickbaitLevelDesc.textContent = levelInfo.description;
        }
    }

    // Load database status
    const dbStatus = await browser().storage.local.get("lastDatabaseUpdate");
    const lastDatabaseUpdate = dbStatus.lastDatabaseUpdate;
    const dbTitleEl = document.getElementById("settingsview-database-status-title");
    if (dbTitleEl) {
        dbTitleEl.textContent = browser().i18n.getMessage("settingsviewDatabaseStatusTitle");
    }
    const dbLastUpdatedEl = document.getElementById("database-last-updated");
    if (dbLastUpdatedEl) {
        if (lastDatabaseUpdate) {
            const date = new Date(lastDatabaseUpdate);
            const dateString = date.toLocaleString();
            dbLastUpdatedEl.textContent = browser().i18n.getMessage("databaseLastUpdated", [dateString]);
        } else {
            dbLastUpdatedEl.textContent = browser().i18n.getMessage("databaseNeverUpdated");
        }
    }
    const dbUpdateBtn = document.getElementById("update-database-btn");
    if (dbUpdateBtn && !dbUpdateBtn.disabled) {
        dbUpdateBtn.textContent = browser().i18n.getMessage("databaseUpdateBtn");
    }

    _refreshSettingsView({
        isConversionEnabled,
        sitesEnabled,
        titleDataUrlSelected,
        isDevelopmentEnv,
        testTitleDataUrl,
        config,
        visualHighlightEnabled,
    });
    _refreshContentView({
        site: pageHostname,
        data: pageStatistics,
        isSiteEnabled: matchingDomain ? isCurrentSiteEnabled : undefined,
    });

    // Load product name and version from manifest
    displayProductInfo();

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
    document.getElementById("open-options").title =
        browser().i18n.getMessage("navigationSettingsLabel");

    document.querySelector("label[for=enable-devmode] span").title =
        browser().i18n.getMessage("devmodeHiddenButtonTitle");
    document.querySelector("label[for=copy-link-signatures]").title =
        browser().i18n.getMessage("devmodeCopyLinkSignaturesTitle");

    const settingsviewDevmodeTitle = document.getElementById("settingsview-devmode-title");
    if (settingsviewDevmodeTitle) {
        settingsviewDevmodeTitle.textContent = browser().i18n.getMessage("settingsviewDevmodeTitle");
    }
    const devmodeDumpLinkHashLabel = document.getElementById("devmode-dumpLinkHash-label");
    if (devmodeDumpLinkHashLabel) {
        devmodeDumpLinkHashLabel.textContent = browser().i18n.getMessage("devmodeDumpLinkHashLabel");
    }
    const devmodeDumpLinkHashBtn = document.getElementById("devmode-dumpLinkHash");
    if (devmodeDumpLinkHashBtn) {
        devmodeDumpLinkHashBtn.textContent = browser().i18n.getMessage("devmodeDumpLinkHashBtn");
    }
    const devmodeSetDebugVisualsLabel = document.getElementById("devmode-setDebugVisuals-label");
    if (devmodeSetDebugVisualsLabel) {
        devmodeSetDebugVisualsLabel.textContent = browser().i18n.getMessage("devmodeSetDebugVisualsLabel");
    }
    const devmodeSetTitleDataUrlLabel = document.getElementById("devmode-setTitleDataUrl-label");
    if (devmodeSetTitleDataUrlLabel) {
        devmodeSetTitleDataUrlLabel.textContent = browser().i18n.getMessage("devmodeSetTitleDataUrlLabel");
    }


    ///////////////////////////////////////////////////////////////////////////////
    // Register handlers for visual changes like moving between views.
    document.querySelector(".open-feedbackview")
        .addEventListener("click", () => view.showView("feedback"));
    document.querySelector(".open-settingsview")
        .addEventListener("click", () => view.showView("settings"));
    document.querySelector(".open-home")
        .addEventListener("click", () => view.showView("main"));

    ///////////////////////////////////////////////////////////////////////////////
    // Register main of/off switch.
    document.getElementById("extension-enabled")
        .addEventListener("click", view.handleClickConversionSwitch);
    document.getElementById("settingsview-extension-enabled")
        .addEventListener("click", view.handleClickMainSwitch);
    const clickbaitSlider = document.getElementById("settingsview-clickbait-level");
    if (clickbaitSlider) {
        clickbaitSlider.addEventListener("input", (e) => {
            const level = parseInt(e.target.value);
            const levelInfo = getClickbaitLevelInfo(level);
            const label = document.getElementById("settingsview-clickbait-level-label");
            if (label) label.textContent = levelInfo.title;
            const desc = document.getElementById("settingsview-clickbait-level-description");
            if (desc) desc.textContent = levelInfo.description;
        });
        clickbaitSlider.addEventListener("change", async (e) => {
            const level = parseInt(e.target.value);
            await controller.setClickbaitLevel(level);
        });
    }
    document.getElementById("open-options")
        .addEventListener("click", () => {
            browser().runtime.openOptionsPage();
            window.close();
        });
    // Register site switches under settings view.
    for (const pageEnabledSwitch of document.querySelectorAll(".settingsview .conversion-switch")) {
        pageEnabledSwitch.addEventListener("click", view.handleClickConversionSwitch);
    }

    ///////////////////////////////////////////////////////////////////////////////
    // Register devmode controls.
    document.getElementById("enable-devmode")
        .addEventListener("click", __devmodeEnable);
    document.getElementById("copy-link-signatures")
        .addEventListener("click", __devmodeCopyLinkSignatures);

    // Wire up devmode settings elements
    const dumpLinkHashBtn = document.getElementById("devmode-dumpLinkHash");
    if (dumpLinkHashBtn) {
        dumpLinkHashBtn.addEventListener("click", __devmodeCopyLinkSignatures);
    }
    const setDebugVisualsCheckbox = document.getElementById("devmode-setDebugVisuals");
    if (setDebugVisualsCheckbox) {
        setDebugVisualsCheckbox.addEventListener("change", async (e) => {
            await browser().storage.local.set({ visualHighlightEnabled: e.target.checked });
        });
    }
    const setTitleDataUrlSelect = document.getElementById("devmode-setTitleDataUrl");
    if (setTitleDataUrlSelect) {
        setTitleDataUrlSelect.addEventListener("change", async (e) => {
            await controller.devmode.setTitleDataUrl(e.target.value);
        });
    }


};

/**
 * Perform initialization when the popup is opened. Load in settings and current
 * page's statistics.
 * @param {*} e 
 */
const handleUpdateDatabaseClick = async (e) => {
    const btn = document.getElementById("update-database-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = browser().i18n.getMessage("databaseUpdateBtnUpdating");
    
    try {
        const response = await browser().runtime.sendMessage({ action: "updateDatabase" });
        if (response && response.success) {
            btn.textContent = browser().i18n.getMessage("databaseUpdateSuccess");
        } else {
            btn.textContent = browser().i18n.getMessage("databaseUpdateFailed");
        }
    } catch (err) {
        log("Error updating database:", err);
        btn.textContent = browser().i18n.getMessage("databaseUpdateFailed");
    } finally {
        setTimeout(async () => {
            btn.disabled = false;
            btn.textContent = browser().i18n.getMessage("databaseUpdateBtn");
        }, 1500);
    }
};

const handleDomContentLoaded = async (e) => {
    log("Setting up UI");

    // Connect directly to the content script in the active tab.
    // The connection automatically signals visibility, and disconnection signals closure.
    const [tab] = await browser().tabs.query({ active: true, currentWindow: true });
    if (tab) {
        try {
            window.contentPort = browser().tabs.connect(tab.id, { name: "paatti-popup-direct" });
        } catch (err) {
            log("Content script not ready to receive connection:", err);
        }
    }

    await refresh();

    // Register database update button click handler
    const dbUpdateBtn = document.getElementById("update-database-btn");
    if (dbUpdateBtn) {
        dbUpdateBtn.addEventListener("click", handleUpdateDatabaseClick);
    }

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
        await model.read.isDevelopmentEnv() ? "free" : "development"
    );
};

const __devmodeCopyLinkSignatures = async (e) => {
    e.target.disabled = true;

    const eventTargetLabel = document.querySelector(`label[for=${e.target.id}]`) || e.target;
    const textContentTemp = eventTargetLabel.textContent;

    // Show that processing has started.
    eventTargetLabel.textContent = "•◦◦";
    const processingAnimationId = setInterval(() => {
        const progress = eventTargetLabel.textContent.split("◦")[0];
        eventTargetLabel.textContent =
            (progress.length >= 3)
            ? "•"
            : "•".repeat(progress.length + 1);

        eventTargetLabel.textContent = eventTargetLabel.textContent.padEnd(3, "◦");
    }, 200);
 
    const pageSignatures = await controller.devmode.dumpLinkSignatures();
    log("Received generated signatures:", pageSignatures);

    const pageSignaturesDump = pageSignatures
        .filter((x) => x !== null)
        .map((x) => x.toString())
        .join("\n");

    await window.navigator.clipboard.write([new ClipboardItem({ "text/plain": pageSignaturesDump })]);

    // Give the illusion that the processing took some time by showing a bit of
    // the processing animation (gives expected feedback to user).
    setTimeout(() => {
        clearInterval(processingAnimationId);
        // Show that processing has finished.
        eventTargetLabel.textContent = "✅";
        setTimeout(() => {
            eventTargetLabel.textContent = textContentTemp;
            e.target.disabled = false;
        }, 1000);
    }, 600);
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
// "Main" handler for when the popup is opened.
document.addEventListener("DOMContentLoaded", view.handleDomContentLoaded);




///////////////////////////////////////////////////////////////////////////////
// "We have events at home."
///////////////////////////////////////////////////////////////////////////////

model.events.addEventListener(modelEvents.enabledChange, view.refresh);
// TODO: Maybe refactor this to abstract local storage away (or don't, wtfgas).
browser().storage.local.onChanged.addListener(view.refresh);

