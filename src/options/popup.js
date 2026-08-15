"use strict";

import { getLogger, browser, getCurrentTabHostname } from "../utils.js";
import { model, modelEvents, Clickbaitiness } from "../model.js";
import { controller } from "../controller.js";
import { getConfig } from "../config.js";
import { computeGaugeValue } from "../stats.js";
import { isSiteEnabled, displayProductInfo, getClickbaitLevelInfo, localizeDocument } from "./utils.js";
import "./components/site-toggle.js";
import "./components/visual-highlight-setting.js";
import "./components/master-switch-setting.js";
import "./components/database-status-setting.js";
import "./components/clickbait-level-horizontal.js";
import "./components/feedback-item.js";
import "./components/compact-button.js";
import "./components/power-button.js";

const log = getLogger("view");

// Track the JSON of the last rendered conversions list to avoid unnecessary DOM rebuilding on scroll.
let lastConversionsJson = null;
let lastConfigSiteKeys = null;

const expandoTemplate = document.createElement("template");
expandoTemplate.innerHTML = `
    <button class="push-button expando-btn" style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.85em; font-weight: 600; color: #475569; cursor: pointer; transition: background 0.15s ease;">
        <span class="expando-btn-text"></span>
        <span class="expando-arrow" style="font-size: 0.85em; transition: transform 0.2s ease;">▼</span>
    </button>
    <div class="expando-content" style="margin-top: 10px; display: flex; flex-direction: column; gap: 12px; width: 100%;">
    </div>
`;

///////////////////////////////////////////////////////////////////////////////
// Helper procedures and definitions.
///////////////////////////////////////////////////////////////////////////////

/**
 * Store the different views' IDs here in order to make making changes a bit
 * flexibler.
 */
const _viewSelectors = {
    "main":
        { "content": ".main-content", "naviItem": "#navi-main" },
    "stats":
        { "content": ".statsview", "naviItem": "#navi-stats" },
    "feedback":
        { "content": ".feedbackview", "naviItem": "#navi-feedback" },
    "settings":
        { "content": ".settingsview", "naviItem": "#navi-settings" },
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

// Cached page stats pushed live from the content script.
let cachedPageStats = null;

const levelToI18nKey = (level) => `clickbaitinessLabel_${level.replaceAll(" ", "_")}`;

const _refreshHomeView = ({ site, pageStats, isSiteEnabled }) => {
    const siteHeaderElem = document.getElementById("site-host");
    // Reset possible error state.
    siteHeaderElem.classList.remove("error");

    const statsTableData = (pageStats || {}).groupedByClickbaitiness || {};
    let statusTextKey = "";

    const requestSiteBtn = document.getElementById("request-site-btn");

    // Show appropriate elements and handle errors.
    if (isSiteEnabled === undefined) {
        siteHeaderElem.classList.add("error");
        siteHeaderElem.textContent = browser().i18n.getMessage("siteTitleProcessingNotSupported");
        statusTextKey = "homeviewStatusNotSupported";

        if (requestSiteBtn) {
            requestSiteBtn.classList.remove("hidden");
            requestSiteBtn.textContent = browser().i18n.getMessage("homeviewRequestSiteBtn");
        }
    } else {
        if (requestSiteBtn) {
            requestSiteBtn.classList.add("hidden");
        }

        if (!isSiteEnabled) {
            siteHeaderElem.classList.add("error");
            siteHeaderElem.textContent = browser().i18n.getMessage("siteTitleProcessingDisabled");
            statusTextKey = "homeviewStatusDisabled";
        } else if (pageStats === null) {
            // Live page stats not yet received from content script (push model is async).
            // Show site hostname in a neutral state — data will arrive via port message shortly.
            siteHeaderElem.textContent = site;
            statusTextKey = "";
        } else if (Object.keys(statsTableData).length === 0) {
            // Page was processed but no matching clickbait elements were found.
            siteHeaderElem.textContent = site;
            statusTextKey = "";
        } else {
            // Page was processed and has clickbait data — show hostname and gauge.
            siteHeaderElem.textContent = site;
            statusTextKey = "";
        }
    }

    // Populate Home/Status view elements
    const homeviewStatusText = document.getElementById("homeview-status-text");
    if (homeviewStatusText) {
        homeviewStatusText.textContent = statusTextKey ? browser().i18n.getMessage(statusTextKey) : "";
    }

    const gaugeContainer = document.getElementById("gauge-container");
    if (isSiteEnabled === undefined || !isSiteEnabled || Object.keys(statsTableData).length === 0) {
        if (gaugeContainer) gaugeContainer.classList.add("hidden");
    } else {
        if (gaugeContainer) gaugeContainer.classList.remove("hidden");

        const { percentage, labelI18nKey } = computeGaugeValue(statsTableData);

        // Update gauge meter fill
        const gaugeFill = document.getElementById("gauge-fill");
        if (gaugeFill) {
            const offset = 110 - (percentage / 100) * 110;
            gaugeFill.style.strokeDashoffset = `${offset}px`;
            gaugeFill.setAttribute("stroke-dashoffset", offset);
        }

        // Update gauge text
        const gaugeText = document.getElementById("gauge-text");
        if (gaugeText) {
            gaugeText.textContent = `${percentage}%`;
        }

        // Update gauge label
        const gaugeLabel = document.getElementById("gauge-label");
        if (gaugeLabel && labelI18nKey) {
            gaugeLabel.textContent = browser().i18n.getMessage(labelI18nKey);
        }
    }

    // Populate live page statistics list under gauge (skip levels with count === 0)
    const pageStatsList = document.getElementById("homeview-page-stats-list");
    if (pageStatsList) {
        pageStatsList.innerHTML = "";
        for (const level of [...Clickbaitiness.LEVELS].reverse()) {
            const count = statsTableData[level] || 0;
            if (count > 0) {
                const li = document.createElement("li");
                li.style.display = "flex";
                li.style.justifyContent = "space-between";
                li.style.width = "100%";
                li.style.padding = "2px 8px";
                li.style.color = "#475569";
                li.style.fontWeight = "500";

                const labelSpan = document.createElement("span");
                labelSpan.textContent = browser().i18n.getMessage(levelToI18nKey(level));

                const countSpan = document.createElement("span");
                countSpan.textContent = String(count);
                countSpan.style.fontWeight = "bold";

                li.appendChild(labelSpan);
                li.appendChild(countSpan);
                pageStatsList.appendChild(li);
            }
        }
    }
};

const _refreshStatsView = ({ cumulativeStats }) => {
    const statsTableData = (cumulativeStats || {}).groupedByClickbaitiness || {};

    // Display total amount of found titles for this site.
    const table = document.getElementById("statistics-grouped-by-clickbaitiness");
    if (table) {
        table.querySelector("tfoot td").textContent = Object.values(statsTableData).reduce((acc, x) => acc + x, 0);

        // The static HTML table has the row elements sorted by clickbaitiness level.
        const clickbaitinessTableRows = table.querySelector("tbody").children;

        for (const row of clickbaitinessTableRows) {
            const levelI8nKey = row.id.replaceAll("-", "_");
            const levelKey = levelI8nKey.split("clickbaitinessLabel_")[1].replaceAll("_", " ");
            row.querySelector("th").textContent = browser().i18n.getMessage(levelI8nKey);
            row.querySelector("td").textContent = statsTableData[levelKey] || 0;
        }

        const statisticsGroupedByClickbaitinessTableHeaders =
            document.querySelectorAll("#statistics-grouped-by-clickbaitiness thead th");
        statisticsGroupedByClickbaitinessTableHeaders[0].textContent =
            browser().i18n.getMessage("statsviewGroupedByClickbaitinessLabelClickbaitiness");
        statisticsGroupedByClickbaitinessTableHeaders[1].textContent =
            browser().i18n.getMessage("statsviewGroupedByClickbaitinessLabelAmount");
        document.querySelector("#statistics-grouped-by-clickbaitiness tfoot th").textContent =
            browser().i18n.getMessage("statsviewGroupedByClickbaitinessLabelTotal");
    }
};

const _refreshSettingsView = ({ isConversionEnabled, isDevelopmentEnv, config }) => {
    const siteKeys = JSON.stringify(config.siteConfigs || {});
    const sitesEnabledList = document.getElementById("sites-enabled-ul");

    if (sitesEnabledList && (siteKeys !== lastConfigSiteKeys || sitesEnabledList.children.length === 0)) {
        lastConfigSiteKeys = siteKeys;
        while (sitesEnabledList.firstChild) {
            sitesEnabledList.removeChild(sitesEnabledList.firstChild);
        }

        // Add the supported sites' listing to UI.
        for (const [host, site] of Object.entries(config.siteConfigs || {})) {
            const siteToggle = document.createElement("site-toggle-setting");
            siteToggle.setAttribute("domain", host);
            siteToggle.setAttribute("name", site.name || host);
            siteToggle.setAttribute("origins", JSON.stringify(site.origins || [`https://${host}/*`]));
            siteToggle.setAttribute("layout", "compact");
            sitesEnabledList.appendChild(siteToggle);
        }
    }


    // Visualize per site switches as "readonly" as per main switch state.
    _setSettingsviewCheckboxesReadonly(isConversionEnabled);

    if (isDevelopmentEnv) {
        document.querySelectorAll(".devmode").forEach((x) => x.classList.remove("hidden"));
        document.querySelector("#logo img").classList.add("hidden");

        // devmode-setDebugVisuals checked state is managed by the visual-highlight-setting component


    } else {
        document.querySelectorAll(".devmode").forEach((x) => x.classList.add("hidden"));
        document.querySelector("#logo img").classList.remove("hidden");
    }

    document.getElementById("settingsview-sites-enabled-title").textContent =
        browser().i18n.getMessage("settingsviewSitesEnabledTitle");
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

    // Update active tab indicator.
    const indicator = document.getElementById("active-tab-indicator");
    if (indicator) {
        let labelKey = "";
        if (viewName === "main") labelKey = "navigationMainLabel";
        else if (viewName === "stats") labelKey = "navigationStatsLabel";
        else if (viewName === "feedback") labelKey = "navigationFeedbackLabel";
        else if (viewName === "settings") labelKey = "navigationSettingsLabel";
        
        indicator.textContent = labelKey ? browser().i18n.getMessage(labelKey) : "";
    }
};

let initialViewSelected = false;

/**
 * Load up current settings to UI.
 */
const refresh = async () => {
    const isConversionEnabled = await model.read.isEnabled();
    const pageHostname = await getCurrentTabHostname();
    const matchingDomain = await model.read.getMatchingSiteDomain(pageHostname);
    const cumulativeStats = matchingDomain ? await model.read.getStatistics(matchingDomain) : null;
    const isDevelopmentEnv = await model.read.isDevelopmentEnv();
    const config = await getConfig();

    const isCurrentSiteEnabled = matchingDomain ? await isSiteEnabled(matchingDomain) : false;

    // Update settings view master switch
    const settingsviewStatusTitle = document.getElementById("settingsview-status-title");
    if (settingsviewStatusTitle) {
        settingsviewStatusTitle.textContent = browser().i18n.getMessage("settingsviewStatusTitle");
    }
    // settingsview-extension-enabled state and label are managed by the master-switch-setting component

    // Update settings view clickbait level section
    const settingsviewClickbaitLevelTitle = document.getElementById("settingsview-clickbait-level-title");
    if (settingsviewClickbaitLevelTitle) {
        settingsviewClickbaitLevelTitle.textContent = browser().i18n.getMessage("settingsviewClickbaitLevelTitle");
    }
    // settingsview-clickbait-level is managed by the clickbait-level-horizontal component

    // Update settings view database status section title
    const dbTitleEl = document.getElementById("settingsview-database-status-title");
    if (dbTitleEl) {
        dbTitleEl.textContent = browser().i18n.getMessage("settingsviewDatabaseStatusTitle");
    }
    // database-last-updated, database-generation-date, and update-database-btn states are managed by the database-status-setting component

    _refreshSettingsView({
        isConversionEnabled,
        isDevelopmentEnv,
        config,
    });
    _refreshHomeView({
        site: pageHostname,
        pageStats: cachedPageStats,
        isSiteEnabled: matchingDomain ? isCurrentSiteEnabled : undefined,
    });
    _refreshStatsView({
        cumulativeStats,
    });

    // Load product name and version from manifest
    displayProductInfo();

    // Load conversions list in feedback view

    const noConversionsEl = document.getElementById("feedbackview-no-conversions");
    const conversionsListEl = document.getElementById("feedbackview-conversions-list");

    let conversions = [];
    const [tab] = await browser().tabs.query({ active: true, currentWindow: true });
    if (tab) {
        try {
            conversions = await browser().tabs.sendMessage(tab.id, { 
                command: "getConversions", 
                onlyVisible: true 
            });
        } catch (err) {
            log("Failed to fetch conversions from content script:", err);
        }
    }

    if (conversionsListEl) {
        const conversionsJson = JSON.stringify(conversions || []);
        
        // Rebuild list only if the data has actually changed to reduce DOM updates and prevent jumping.
        if (conversionsJson !== lastConversionsJson) {
            lastConversionsJson = conversionsJson;

            // Check if the expando was open before clearing and rebuilding.
            const expandoContentEl = conversionsListEl.querySelector(".expando-content");
            const expandoWasOpen = expandoContentEl && !expandoContentEl.classList.contains("hidden");

            conversionsListEl.innerHTML = "";
            const activeConversions = (conversions || []).filter(item => !item.isUnderThreshold);
            const underThresholdConversions = (conversions || []).filter(item => item.isUnderThreshold);

            if (activeConversions.length === 0) {
                if (noConversionsEl) {
                    noConversionsEl.textContent = browser().i18n.getMessage("feedbackviewNoConversions");
                    noConversionsEl.classList.remove("hidden");
                }
            } else {
                if (noConversionsEl) {
                    noConversionsEl.classList.add("hidden");
                }
                for (const item of activeConversions) {
                    const feedbackEl = document.createElement("feedback-item");
                    feedbackEl.item = item;
                    feedbackEl.activeTab = tab;
                    conversionsListEl.appendChild(feedbackEl);
                }
            }

            // If there are under-threshold items, add an expando at the bottom
            if (underThresholdConversions.length > 0) {
                const expandoContainer = document.createElement("div");
                expandoContainer.className = "expando-container";
                expandoContainer.style.width = "100%";
                expandoContainer.style.marginTop = "15px";

                const expandoBtnText = browser().i18n.getMessage("feedbackviewShowBelowThresholdBtn", [underThresholdConversions.length]) || `Näytä klikkikynnyksen alittavat otsikot (${underThresholdConversions.length})`;

                // Render the expando with its previous open/closed state.
                expandoContainer.replaceChildren(expandoTemplate.content.cloneNode(true));

                const expandoBtn = expandoContainer.querySelector(".expando-btn");
                const expandoContent = expandoContainer.querySelector(".expando-content");
                const expandoArrow = expandoContainer.querySelector(".expando-arrow");
                const expandoBtnTextEl = expandoContainer.querySelector(".expando-btn-text");

                if (expandoBtnTextEl) {
                    expandoBtnTextEl.textContent = `🔍 ${expandoBtnText}`;
                }

                if (expandoWasOpen) {
                    expandoBtn.style.background = "#e2e8f0";
                    expandoArrow.style.transform = "rotate(180deg)";
                    expandoContent.classList.remove("hidden");
                } else {
                    expandoBtn.style.background = "#f8fafc";
                    expandoArrow.style.transform = "";
                    expandoContent.classList.add("hidden");
                }

                // Populate under-threshold items inside the expando content
                for (const item of underThresholdConversions) {
                    const feedbackEl = document.createElement("feedback-item");
                    feedbackEl.item = item;
                    feedbackEl.activeTab = tab;
                    expandoContent.appendChild(feedbackEl);
                }

                expandoBtn.addEventListener("click", () => {
                    const isHidden = expandoContent.classList.contains("hidden");
                    if (isHidden) {
                        expandoContent.classList.remove("hidden");
                        expandoArrow.style.transform = "rotate(180deg)";
                        expandoBtn.style.background = "#e2e8f0";

                        // Smooth scroll to the first item of the expanded list
                        const firstItem = expandoContent.querySelector("feedback-item");
                        if (firstItem) {
                            setTimeout(() => {
                                firstItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
                            }, 50);
                        }
                    } else {
                        expandoContent.classList.add("hidden");
                        expandoArrow.style.transform = "rotate(0deg)";
                        expandoBtn.style.background = "#f8fafc";
                    }
                });

                conversionsListEl.appendChild(expandoContainer);
            }
        }
    }

    document.getElementById("navi-main").parentElement.title =
        browser().i18n.getMessage("navigationMainLabel");
    document.getElementById("navi-stats").parentElement.title =
        browser().i18n.getMessage("navigationStatsLabel");
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
    const openOptionsBtn = document.getElementById("open-options-btn");
    if (openOptionsBtn) {
        openOptionsBtn.textContent = browser().i18n.getMessage("preferencesViewMoreSettingsBtn");
    }
    // Label text is managed by the visual-highlight-setting component


    if (!initialViewSelected) {
        initialViewSelected = true;
        if (conversions && conversions.some(item => item.isMainPage)) {
            view.showView("feedback");
            const naviFeedback = document.getElementById("navi-feedback");
            if (naviFeedback) {
                naviFeedback.checked = true;
            }
        } else {
            view.showView("main");
        }
    }
};

/**
 * Perform initialization when the popup is opened. Load in settings and current
 * page's statistics.
 * @param {*} e 
 */
// handleUpdateDatabaseClick is now encapsulated in the database-status-setting component

const handleDomContentLoaded = async (e) => {
    localizeDocument();
    log("Setting up UI");

    // Connect directly to the content script in the active tab.
    // The connection automatically signals visibility, and disconnection signals closure.
    const [tab] = await browser().tabs.query({ active: true, currentWindow: true });
    if (tab) {
        try {
            window.contentPort = browser().tabs.connect(tab.id, { name: "paatti-popup-direct" });
            window.contentPort.onMessage.addListener(async (msg) => {
                if (msg && msg.action === "pageStatsUpdated") {
                    log("Received live pageStats from content script:", msg.pageStats);
                    cachedPageStats = msg.pageStats;
                    const pageHostname = await getCurrentTabHostname();
                    const matchingDomain = await model.read.getMatchingSiteDomain(pageHostname);
                    const isCurrentSiteEnabled = matchingDomain ? await isSiteEnabled(matchingDomain) : false;
                    _refreshHomeView({
                        site: pageHostname,
                        pageStats: cachedPageStats,
                        isSiteEnabled: matchingDomain ? isCurrentSiteEnabled : undefined,
                    });
                }
            });
        } catch (err) {
            log("Content script not ready to receive connection:", err);
        }
    }

    ///////////////////////////////////////////////////////////////////////////////
    // Register handlers for visual changes like moving between views.
    document.querySelector(".open-statsview")
        .addEventListener("click", () => view.showView("stats"));
    document.querySelector(".open-feedbackview")
        .addEventListener("click", () => view.showView("feedback"));
    document.querySelector(".open-settingsview")
        .addEventListener("click", () => view.showView("settings"));
    document.querySelector(".open-home")
        .addEventListener("click", () => view.showView("main"));

    // settingsview-extension-enabled click listener is managed by the master-switch-setting component
    // settingsview-clickbait-level inputs and label states are managed by the clickbait-level-horizontal component
    document.getElementById("open-options")
        .addEventListener("click", () => {
            browser().runtime.openOptionsPage();
            window.close();
        });

    const openOptionsBtnEl = document.getElementById("open-options-btn");
    if (openOptionsBtnEl) {
        openOptionsBtnEl.addEventListener("click", () => {
            browser().runtime.openOptionsPage();
            window.close();
        });
    }

    const requestSiteBtn = document.getElementById("request-site-btn");
    if (requestSiteBtn) {
        requestSiteBtn.addEventListener("click", async () => {
            const hostname = await getCurrentTabHostname();
            const url = `https://github.com/klikkikuri/paatti/issues?q=is%3Aissue+${encodeURIComponent(hostname)}`;
            browser().tabs.create({ url });
        });
    }

    // Manual database update click handler is managed by the database-status-setting component

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
    // devmode-setDebugVisuals change listener is managed by the visual-highlight-setting component


    await refresh();
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
    refresh: refresh,
};

///////////////////////////////////////////////////////////////////////////////
// "Main" handler for when the popup is opened.
document.addEventListener("DOMContentLoaded", view.handleDomContentLoaded);




///////////////////////////////////////////////////////////////////////////////
// "We have events at home."
///////////////////////////////////////////////////////////////////////////////

model.events.addEventListener(modelEvents.enabledChange, view.refresh);
model.events.addEventListener(modelEvents.statisticsChange, view.refresh);
// TODO: Maybe refactor this to abstract local storage away (or don't, wtfgas).
browser().storage.local.onChanged.addListener(view.refresh);

// Listen for page scroll events sent from the content script and refresh the popup content.
browser().runtime.onMessage.addListener((message) => {
    if (message.action === "pageScrolled") {
        // Prevent refreshing if the user has an active feedback typing form open.
        // We query for .feedback-input-container since that is used by feedback-item components.
        const activeFeedbackForm = document.querySelector(".feedback-input-container:not(.hidden)");
        if (!activeFeedbackForm) {
            view.refresh();
        }
    }
});

