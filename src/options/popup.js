"use strict";

import { getLogger, browser, getCurrentTabHostname } from "../utils.js";
import { model, modelEvents } from "../model.js";
import { controller } from "../controller.js";
import { getConfig } from "../config.js";
import { isSiteEnabled, displayProductInfo, getClickbaitLevelInfo } from "./utils.js";

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

const _refreshContentView = ({ site, data, isSiteEnabled }) => {
    const siteHeaderElem = document.getElementById("site-host");
    // Reset possible error state.
    siteHeaderElem.classList.remove("error");

    const statsTableData = (data || {}).groupedByClickbaitiness || {};
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
        } else if (Object.keys(data || {}).length === 0) {
            siteHeaderElem.classList.add("error");
            siteHeaderElem.textContent = browser().i18n.getMessage("statsErrorUserFixInstructions");
            statusTextKey = "statsErrorUserFixInstructions";
        } else {
            // Display that this site is supported and processed.
            document.getElementById("site-host").textContent = site;
            statusTextKey = "";
        }
    }

    // Populate Home/Status view elements
    const homeviewHeader = document.getElementById("homeview-header");
    if (homeviewHeader) {
        homeviewHeader.textContent = browser().i18n.getMessage("homeviewHeader");
    }
    const homeviewStatusText = document.getElementById("homeview-status-text");
    if (homeviewStatusText) {
        homeviewStatusText.textContent = statusTextKey ? browser().i18n.getMessage(statusTextKey) : "";
    }

    const gaugeContainer = document.getElementById("gauge-container");
    if (isSiteEnabled === undefined || !isSiteEnabled || Object.keys(data || {}).length === 0) {
        if (gaugeContainer) gaugeContainer.classList.add("hidden");
    } else {
        if (gaugeContainer) gaugeContainer.classList.remove("hidden");

        const levelValues = {
            "Not Clickbait at all": 0,
            "Slightly Clickbaity": 1,
            "Moderately Clickbaity": 2,
            "Very Clickbaity": 3,
            "Extremely Clickbaity": 4
        };

        let totalCount = 0;
        let totalValue = 0;
        for (const [key, count] of Object.entries(statsTableData)) {
            const val = levelValues[key];
            if (val !== undefined) {
                totalCount += count;
                totalValue += count * val;
            }
        }

        const averageValue = totalCount > 0 ? (totalValue / totalCount) : 0;
        const percentage = Math.round((averageValue / 4) * 100);

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

        // Determine descriptive label
        let labelI18nKey = "";
        if (averageValue < 0.5) {
            labelI18nKey = "clickbaitinessLabel Not Clickbait at all";
        } else if (averageValue < 1.5) {
            labelI18nKey = "clickbaitinessLabel Slightly Clickbaity";
        } else if (averageValue < 2.5) {
            labelI18nKey = "clickbaitinessLabel Moderately Clickbaity";
        } else if (averageValue < 3.5) {
            labelI18nKey = "clickbaitinessLabel Very Clickbaity";
        } else {
            labelI18nKey = "clickbaitinessLabel Extremely Clickbaity";
        }

        const gaugeLabel = document.getElementById("gauge-label");
        if (gaugeLabel) {
            gaugeLabel.textContent = browser().i18n.getMessage(labelI18nKey);
        }
    }

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

const _refreshSettingsView = ({ isConversionEnabled, sitesEnabled, titleDataUrlSelected, isDevelopmentEnv, testTitleDataUrl, config, visualHighlightEnabled, sitesPermissions }) => {

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
        input.dataset.origins = JSON.stringify(site.origins || [`https://${host}/*`]);
        input.dataset.hasPermission = String(sitesPermissions?.[host] || false);
        input.type = "checkbox";
        input.addEventListener("click", view.handleClickConversionSwitch);
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
    const checked = e.target.checked;
    const hostname = e.target.dataset.hostname;
    const hasPermission = e.target.dataset.hasPermission === "true";
    
    let origins = [];
    try {
        origins = JSON.parse(e.target.dataset.origins || "[]");
    } catch (err) {
        log("Error parsing origins dataset:", err);
    }

    if (checked && origins.length > 0) {
        if (hasPermission) {
            // Already has permissions, just update settings
            await controller.setSiteEnabled(true, hostname);
        } else {
            // Request permissions synchronously (gesture is active) and close the popup immediately so it doesn't cover the prompt
            log("Requesting optional permissions for:", origins);
            browser().permissions.request({ origins });
            window.close();
        }
    } else {
        // If disabling, update settings but do NOT drop the permission (keep it granted)
        await controller.setSiteEnabled(false, hostname);
    }
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

    const sitesPermissions = {};
    for (const host of Object.keys(config.siteConfigs)) {
        const origins = config.siteConfigs[host]?.origins || [];
        sitesPermissions[host] = origins.length > 0 ? await browser().permissions.contains({ origins }) : false;
    }


    const matchingDomain = await model.read.getMatchingSiteDomain(pageHostname);
    const isCurrentSiteEnabled = matchingDomain ? await isSiteEnabled(matchingDomain) : false;
    const isSiteSupported = matchingDomain !== null;
    const powerCheckbox = document.getElementById("site-enabled");
    if (powerCheckbox) {
        powerCheckbox.checked = isCurrentSiteEnabled;
        powerCheckbox.disabled = !isSiteSupported;
        powerCheckbox.dataset.hostname = matchingDomain || pageHostname;
        const origins = matchingDomain ? config.siteConfigs[matchingDomain]?.origins : [];
        powerCheckbox.dataset.origins = JSON.stringify(origins || [`https://${pageHostname}/*`]);
        const hasPowerPermission = matchingDomain ? (sitesPermissions[matchingDomain] || false) : false;
        powerCheckbox.dataset.hasPermission = String(hasPowerPermission);
    }

    const powerLabel = document.querySelector("label[for=site-enabled]");
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
        sitesPermissions,
    });
    _refreshContentView({
        site: pageHostname,
        data: pageStatistics,
        isSiteEnabled: matchingDomain ? isCurrentSiteEnabled : undefined,
    });

    // Load product name and version from manifest
    displayProductInfo();

    // Load conversions list in feedback view
    const feedbackHeader = document.getElementById("feedbackview-header");
    if (feedbackHeader) {
        feedbackHeader.textContent = browser().i18n.getMessage("feedbackviewRateTitleHeader");
    }

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
        conversionsListEl.innerHTML = "";
        if (!conversions || conversions.length === 0) {
            if (noConversionsEl) {
                noConversionsEl.textContent = browser().i18n.getMessage("feedbackviewNoConversions");
                noConversionsEl.classList.remove("hidden");
            }
        } else {
            if (noConversionsEl) {
                noConversionsEl.classList.add("hidden");
            }
            const template = document.getElementById("feedback-item-template");
            for (const item of conversions) {
                const clone = template.content.cloneNode(true);

                const origLabelEl = clone.querySelector(".feedback-orig-label");
                const origTextEl = clone.querySelector(".feedback-orig-text");
                let origLabel = browser().i18n.getMessage("feedbackviewRateTitleOriginalTitleLabel");
                if (item.isMainPage) {
                    origLabel += " (" + browser().i18n.getMessage("feedbackviewCurrentPageLabel") + ")";
                }
                origLabelEl.textContent = origLabel;
                origTextEl.textContent = item.originalTitle;

                const convLabelEl = clone.querySelector(".feedback-conv-label");
                const convTextEl = clone.querySelector(".feedback-conv-text");
                convLabelEl.textContent = browser().i18n.getMessage("feedbackviewRateTitleConvertedTitleLabel");
                convTextEl.textContent = item.convertedTitle;

                const buttonsDiv = clone.querySelector(".feedback-buttons-container");
                const formDiv = clone.querySelector(".feedback-form-container");
                const feedbackInput = clone.querySelector(".feedback-input");
                
                const goodBtn = clone.querySelector(".feedback-good-btn");
                const badBtn = clone.querySelector(".feedback-bad-btn");
                const submitBtn = clone.querySelector(".feedback-submit-btn");

                feedbackInput.placeholder = browser().i18n.getMessage("feedbackviewReportCommentPlaceholder");
                goodBtn.textContent = "👍 " + browser().i18n.getMessage("feedbackviewRateTitleConversionIsGood");
                badBtn.textContent = "👎 " + browser().i18n.getMessage("feedbackviewRateTitleConversionIsBad");
                submitBtn.textContent = browser().i18n.getMessage("feedbackviewReportSubmitBtn");

                const submitFeedback = async (type, comment = "") => {
                    let feedbackServerUrl = "https://api.klikkikuri.fi/v1/feedback";
                    try {
                        const config = await getConfig();
                        if (config && config.feedbackServerUrl) {
                            feedbackServerUrl = config.feedbackServerUrl;
                        }
                    } catch (err) {
                        log("Error loading config for feedback server URL:", err);
                    }

                    const dbStatus = await browser().storage.local.get("lastDatabaseUpdate");
                    const databaseUpdated = dbStatus.lastDatabaseUpdate ? new Date(dbStatus.lastDatabaseUpdate).toISOString() : "Unknown";
                    const commentVal = comment.trim() || "-";

                    const pageUrl = tab?.url || "";
                    const urlSign = item.urlSign || "";
                    const originalTitle = item.originalTitle || "";
                    const convertedTitle = item.convertedTitle || "";
                    const clickbaitLevel = (item.clickbaitLevel !== undefined && item.clickbaitLevel !== null) ? String(item.clickbaitLevel) : "";

                    // Client-side validation: all fields are required
                    if (!pageUrl || !urlSign || !originalTitle || !convertedTitle || clickbaitLevel === "" || !type || !commentVal || !databaseUpdated) {
                        log("Validation failed: missing required feedback fields", {
                            pageUrl,
                            urlSign,
                            originalTitle,
                            convertedTitle,
                            clickbaitLevel,
                            type,
                            commentVal,
                            databaseUpdated
                        });
                        return false;
                    }

                    const isGoogleForm = feedbackServerUrl.includes("docs.google.com/forms");

                    try {
                        if (isGoogleForm) {
                            let postUrl = feedbackServerUrl;
                            if (postUrl.endsWith("/viewform")) {
                                postUrl = postUrl.replace("/viewform", "/formResponse");
                            } else if (!postUrl.endsWith("/formResponse")) {
                                if (postUrl.endsWith("/")) {
                                    postUrl += "formResponse";
                                } else {
                                    postUrl += "/formResponse";
                                }
                            }

                            const formData = new URLSearchParams();
                            formData.append("entry.1944615860", pageUrl);
                            formData.append("entry.1369854914", urlSign);
                            formData.append("entry.917360051", originalTitle);
                            formData.append("entry.1935829065", convertedTitle);
                            formData.append("entry.1807257025", clickbaitLevel);
                            formData.append("entry.167673994", type);
                            formData.append("entry.78795748", commentVal);
                            formData.append("entry.364993842", databaseUpdated);

                            await fetch(postUrl, {
                                method: "POST",
                                mode: "no-cors",
                                headers: {
                                    "Content-Type": "application/x-www-form-urlencoded"
                                },
                                body: formData.toString()
                            });
                        } else {
                            const payload = {
                                timestamp: new Date().toISOString(),
                                pageUrl: pageUrl,
                                urlSign: urlSign,
                                originalTitle: originalTitle,
                                convertedTitle: convertedTitle,
                                clickbaitLevel: item.clickbaitLevel,
                                feedbackType: type,
                                comment: comment,
                                databaseUpdated: databaseUpdated
                            };

                            await fetch(feedbackServerUrl, {
                                method: "POST",
                                mode: "no-cors",
                                headers: {
                                    "Content-Type": "text/plain"
                                },
                                body: JSON.stringify(payload)
                            });
                        }
                        return true;
                    } catch (err) {
                        log("Failed to submit feedback:", err);
                        return false;
                    }
                };

                const setFeedbackStatus = (text, color, isBold) => {
                    buttonsDiv.textContent = "";
                    const span = document.createElement("span");
                    span.style.color = color;
                    span.style.fontSize = "0.85em";
                    if (isBold) {
                        span.style.fontWeight = "bold";
                    }
                    span.textContent = text;
                    buttonsDiv.appendChild(span);
                };

                goodBtn.addEventListener("click", async () => {
                    setFeedbackStatus("...", "#666", false);
                    const success = await submitFeedback("good_conversion");
                    if (success) {
                        setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportSuccess"), "green", true);
                    } else {
                        setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportFailure"), "#e14942", true);
                    }
                });

                const cancelFlow = () => {
                    formDiv.classList.add("hidden");
                    buttonsDiv.style.display = "flex";
                    feedbackInput.value = "";
                };

                const triggerSubmit = async () => {
                    feedbackInput.disabled = true;
                    submitBtn.disabled = true;
                    submitBtn.textContent = "...";

                    const success = await submitFeedback("bad_conversion", feedbackInput.value);

                    formDiv.classList.add("hidden");
                    buttonsDiv.style.display = "flex";
                    if (success) {
                        setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportSuccess"), "green", true);
                    } else {
                        setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportFailure"), "#e14942", true);
                    }
                };

                badBtn.addEventListener("click", () => {
                    buttonsDiv.style.display = "none";
                    formDiv.classList.remove("hidden");
                    feedbackInput.focus();
                });

                feedbackInput.addEventListener("keydown", async (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        await triggerSubmit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelFlow();
                    }
                });

                submitBtn.addEventListener("click", triggerSubmit);

                conversionsListEl.appendChild(clone);
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
    const devmodeSetDebugVisualsLabel = document.getElementById("devmode-setDebugVisuals-label");
    if (devmodeSetDebugVisualsLabel) {
        devmodeSetDebugVisualsLabel.textContent = browser().i18n.getMessage("devmodeSetDebugVisualsLabel");
    }
    const devmodeSetTitleDataUrlLabel = document.getElementById("devmode-setTitleDataUrl-label");
    if (devmodeSetTitleDataUrlLabel) {
        devmodeSetTitleDataUrlLabel.textContent = browser().i18n.getMessage("devmodeSetTitleDataUrlLabel");
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

    ///////////////////////////////////////////////////////////////////////////////
    // Register main of/off switch.
    document.getElementById("site-enabled")
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

    const requestSiteBtn = document.getElementById("request-site-btn");
    if (requestSiteBtn) {
        requestSiteBtn.addEventListener("click", async () => {
            const hostname = await getCurrentTabHostname();
            const url = `https://github.com/klikkikuri/paatti/issues?q=is%3Aissue+${encodeURIComponent(hostname)}`;
            browser().tabs.create({ url });
        });
    }

    // Register database update button click handler
    const dbUpdateBtn = document.getElementById("update-database-btn");
    if (dbUpdateBtn) {
        dbUpdateBtn.addEventListener("click", handleUpdateDatabaseClick);
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
model.events.addEventListener(modelEvents.statisticsChange, view.refresh);
// TODO: Maybe refactor this to abstract local storage away (or don't, wtfgas).
browser().storage.local.onChanged.addListener(view.refresh);

