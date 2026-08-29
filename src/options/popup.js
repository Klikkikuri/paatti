"use strict";

import browser from "../browser-api.js";
import { getLogger, getActiveTab, getCurrentTabHostname } from "../utils.js";
import { model, Clickbaitiness } from "../model.js";
import { controller } from "../controller.js";
import { getConfig, onConfigValue } from "../config.js";
import { computeGaugeValue, computeCollectingPeriod, summarizeLevels } from "../stats.js";
import { isSiteEnabled, getClickbaitLevelInfo, levelToI18nKey, localizeDocument } from "./utils.js";
import "./components/site-toggle.js";
import "./components/visual-highlight-setting.js";
import "./components/master-switch-setting.js";
import "./components/database-status-setting.js";
import "./components/clickbait-level-horizontal.js";
import "./components/feedback-item.js";
import "./components/compact-button.js";
import "./components/power-button.js";
import "./components/page-background.js";

const log = getLogger("view");

// Track the JSON of the last rendered conversions list to avoid unnecessary DOM rebuilding on scroll.
let lastConversionsJson = null;
let lastConfigSiteKeys = null;

const expandoTemplate = document.createElement("template");
expandoTemplate.innerHTML = `
    <button class="push-button expando-btn" style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border: 1px solid var(--color-border-subtle); border-radius: 8px; font-size: 0.85em; font-weight: 600; color: var(--color-text-secondary); cursor: pointer; transition: background 0.15s ease;">
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

/**
 * Create a stat row element for a given clickbait level and count.
 * @param {string} level Clickbaitiness level
 * @param {number} count Count of occurrences
 * @param {Object} [options] Optional configuration
 * @param {number} [options.clickbaitLevelThreshold] Current active threshold level (0-4)
 * @param {number} [options.maxCount] Largest count in the list; adds a proportion bar when given
 * @param {number} [options.rewritten] How many of the count were rewritten. Omit when unknown,
 *   and the bar shows magnitude alone rather than implying a share of zero
 * @returns {HTMLDivElement} Row element containing <dt> and <dd>
 */
const _createStatRow = (level, count, { clickbaitLevelThreshold, maxCount, rewritten } = {}) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "stats-row";

    const mainDiv = document.createElement("div");
    mainDiv.className = "stats-row-main";

    const dt = document.createElement("dt");
    dt.className = "stats-label";

    const labelText = document.createElement("span");
    labelText.className = "stats-label-text";
    labelText.textContent = browser.i18n.getMessage(levelToI18nKey(level));

    const dd = document.createElement("dd");
    dd.className = "stats-count";
    dd.textContent = String(count);

    // Add combined color dot and info indicator button and inline details
    const levelIndex = Clickbaitiness.stringToNumber(level);
    const levelInfo = getClickbaitLevelInfo(levelIndex);

    rowDiv.dataset.level = level.toLowerCase().replaceAll(" ", "-");

    const dotBtn = document.createElement("button");
    dotBtn.type = "button";
    dotBtn.className = "stats-dot-btn";
    dotBtn.dataset.level = rowDiv.dataset.level;

    if (typeof clickbaitLevelThreshold === "number") {
        dotBtn.dataset.zone = levelIndex >= clickbaitLevelThreshold ? "water" : "sky";
    }

    dotBtn.textContent = "i";
    dotBtn.setAttribute("aria-label", browser.i18n.getMessage("statsviewInfoBtnAriaLabel", [labelText.textContent]));
    dotBtn.setAttribute("aria-expanded", "false");
    dotBtn.setAttribute("title", levelInfo.description || "");

    dt.appendChild(dotBtn);
    dt.appendChild(labelText);

    // Create inline details container with description only
    const detailsDiv = document.createElement("div");
    detailsDiv.className = "stats-row-details hidden";

    const descSpan = document.createElement("span");
    descSpan.className = "stats-details-desc";
    descSpan.textContent = levelInfo.description || "";
    detailsDiv.appendChild(descSpan);

    const toggleDetails = (e) => {
        e?.stopPropagation();
        const willOpen = detailsDiv.classList.contains("hidden");

        // Close other open details rows
        document.querySelectorAll(".stats-row.is-open").forEach((row) => {
            if (row !== rowDiv) {
                row.classList.remove("is-open");
                const otherBtn = row.querySelector(".stats-dot-btn");
                if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
                const otherDetails = row.querySelector(".stats-row-details");
                if (otherDetails) otherDetails.classList.add("hidden");
            }
        });

        if (willOpen) {
            detailsDiv.classList.remove("hidden");
            rowDiv.classList.add("is-open");
            dotBtn.setAttribute("aria-expanded", "true");
        } else {
            detailsDiv.classList.add("hidden");
            rowDiv.classList.remove("is-open");
            dotBtn.setAttribute("aria-expanded", "false");
        }
    };

    dotBtn.addEventListener("click", toggleDetails);

    mainDiv.appendChild(dt);
    mainDiv.appendChild(dd);
    rowDiv.appendChild(mainDiv);

    if (typeof maxCount === "number" && maxCount > 0) {
        const bar = document.createElement("div");
        bar.className = "stats-bar";

        // Set as a style rather than templated into markup, which web-ext lint reads as an unsafe
        // assignment.
        const fill = document.createElement("div");
        fill.className = "stats-bar-fill";
        fill.style.width = `${(count / maxCount) * 100}%`;

        if (typeof rewritten === "number") {
            const rewrittenEl = document.createElement("div");
            rewrittenEl.className = "stats-bar-rewritten";
            rewrittenEl.style.width = count > 0 ? `${(rewritten / count) * 100}%` : "0%";
            fill.appendChild(rewrittenEl);

            rowDiv.setAttribute("title", browser.i18n.getMessage(
                "statsviewRowRewritten", [String(rewritten), String(count)]));
        } else {
            fill.classList.add("is-plain");
        }

        bar.appendChild(fill);
        rowDiv.appendChild(bar);
    }

    rowDiv.appendChild(detailsDiv);

    return rowDiv;
};

/**
 * Attaches pointer-based drag behaviour to the threshold divider element.
 * @param {HTMLElement} dividerEl
 * @param {Object} options
 * @param {() => { el: HTMLElement, levelIndex: number }[]} options.getVisibleRows
 * @param {(level: number) => void} options.onDrop
 */
const _attachThresholdDrag = (dividerEl, { getVisibleRows, onDrop }) => {
    let startY = 0;
    let didDrag = false;
    let currentTargetLevel = null;

    const onPointerMove = (e) => {
        const dy = Math.abs(e.clientY - startY);
        if (dy > 4) {
            didDrag = true;
        }

        const rows = getVisibleRows();
        currentTargetLevel = null;
        
        let targetIndex = rows.length;
        for (let i = 0; i < rows.length; i++) {
            const rect = rows[i].el.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                targetIndex = i;
                break;
            }
        }
        
        for (const { el } of rows) {
            el.classList.remove("drop-target-above", "drop-target-bottom");
        }
        dividerEl.classList.remove("drop-not-allowed");

        if (didDrag && rows.length > 0) {
            if (targetIndex < rows.length) {
                // Drop above row at targetIndex
                rows[targetIndex].el.classList.add("drop-target-above");
                currentTargetLevel = rows[targetIndex].levelIndex;
                
                if (targetIndex > 0) {
                    rows[targetIndex - 1].el.classList.add("drop-target-bottom");
                }
            } else {
                // Dragged below the last visible row
                const lastRow = rows[rows.length - 1];
                if (lastRow.levelIndex < 4) {
                    // Valid drop target in a sparse list (e.g. last item is level 2 -> threshold becomes 3)
                    lastRow.el.classList.add("drop-target-bottom");
                    currentTargetLevel = lastRow.levelIndex + 1;
                } else {
                    // Last item is Level 4 (Extreme) -> cannot drag below max threshold
                    currentTargetLevel = null;
                    dividerEl.classList.add("drop-not-allowed");
                }
            }
        }
    };

    const onPointerUp = (e) => {
        dividerEl.releasePointerCapture(e.pointerId);
        dividerEl.removeEventListener("pointermove", onPointerMove);
        dividerEl.removeEventListener("pointerup", onPointerUp);
        dividerEl.removeEventListener("pointercancel", onPointerUp);
        dividerEl.classList.remove("is-dragging", "drop-not-allowed");

        const rows = getVisibleRows();
        for (const { el } of rows) {
            el.classList.remove("drop-target-above", "drop-target-bottom");
        }

        if (didDrag && currentTargetLevel !== null) {
            onDrop(currentTargetLevel);
        }
    };

    dividerEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        startY = e.clientY;
        didDrag = false;
        currentTargetLevel = null;
        dividerEl.setPointerCapture(e.pointerId);
        dividerEl.classList.add("is-dragging");
        dividerEl.addEventListener("pointermove", onPointerMove);
        dividerEl.addEventListener("pointerup", onPointerUp);
        dividerEl.addEventListener("pointercancel", onPointerUp);
    });
};

/**
 * Create a threshold divider element with hook emoji.
 * @returns {HTMLDivElement}
 */
const _createThresholdDivider = () => {
    const divider = document.createElement("div");
    divider.className = "stats-threshold-divider";

    const label = document.createElement("span");
    label.className = "stats-threshold-divider-label";
    label.textContent = `🪝 ${browser.i18n.getMessage("statsThresholdDividerLabel")}`;
    divider.setAttribute("title", browser.i18n.getMessage("statsThresholdDividerLabel") || "");

    divider.appendChild(label);
    return divider;
};

const _refreshHomeView = ({ site, pageStats, isSiteEnabled, clickbaitLevelThreshold }) => {
    const siteHeaderElem = document.getElementById("site-host");
    // Reset possible error state.
    siteHeaderElem.classList.remove("error");

    const statsTableData = (pageStats || {}).groupedByClickbaitiness || {};
    let statusTextKey = "";

    const requestSiteBtn = document.getElementById("request-site-btn");

    // Show appropriate elements and handle errors.
    if (isSiteEnabled === undefined) {
        siteHeaderElem.classList.add("error");
        siteHeaderElem.textContent = browser.i18n.getMessage("siteTitleProcessingNotSupported");
        statusTextKey = "homeviewStatusNotSupported";

        if (requestSiteBtn) {
            requestSiteBtn.classList.remove("hidden");
            requestSiteBtn.textContent = browser.i18n.getMessage("homeviewRequestSiteBtn");
        }
    } else {
        if (requestSiteBtn) {
            requestSiteBtn.classList.add("hidden");
        }

        if (!isSiteEnabled) {
            siteHeaderElem.classList.add("error");
            siteHeaderElem.textContent = browser.i18n.getMessage("siteTitleProcessingDisabled");
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
        homeviewStatusText.textContent = statusTextKey ? browser.i18n.getMessage(statusTextKey) : "";
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
            gaugeLabel.textContent = browser.i18n.getMessage(labelI18nKey);
        }
    }

    // Populate live page statistics list under gauge (skip levels with count === 0)
    const pageStatsList = document.getElementById("homeview-page-stats-list");
    if (pageStatsList) {
        pageStatsList.replaceChildren();

        const { shown } = summarizeLevels(
            statsTableData, (pageStats || {}).convertedByClickbaitiness, Clickbaitiness.LEVELS);
        const visibleLevels = shown.map((row) => row.level);

        const hasExtremeLast = visibleLevels.length > 0 &&
            visibleLevels[visibleLevels.length - 1] === Clickbaitiness.LEVEL_EXTREME;
        pageStatsList.classList.toggle("no-bottom-padding", hasExtremeLast);

        if (visibleLevels.length > 0 && typeof clickbaitLevelThreshold === "number") {
            let dividerInserted = false;
            const rowElements = [];

            const divider = _createThresholdDivider();
            _attachThresholdDrag(divider, {
                getVisibleRows: () => rowElements,
                onDrop: async (newLevel) => {
                    await controller.setClickbaitLevel(newLevel);
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                }
            });

            for (const level of visibleLevels) {
                const levelIndex = Clickbaitiness.stringToNumber(level);
                if (!dividerInserted && levelIndex >= clickbaitLevelThreshold) {
                    pageStatsList.appendChild(divider);
                    dividerInserted = true;
                }
                const rowEl = _createStatRow(level, statsTableData[level], { clickbaitLevelThreshold });
                rowElements.push({ el: rowEl, levelIndex });
                pageStatsList.appendChild(rowEl);
            }

            if (!dividerInserted && clickbaitLevelThreshold <= 4) {
                pageStatsList.appendChild(divider);
            }
        } else {
            for (const level of visibleLevels) {
                pageStatsList.appendChild(_createStatRow(level, statsTableData[level], { clickbaitLevelThreshold }));
            }
        }
    }
};

/**
 * Fills the stats view eyebrow: how long the tally has been running. The site it belongs to is
 * already named in the popup header.
 * @param {number} [firstSeen] Epoch ms collection started
 */
const _refreshStatsHeader = (firstSeen) => {
    const periodEl = document.getElementById("statsview-collecting-period");
    if (!periodEl) return;

    const period = computeCollectingPeriod(firstSeen);
    if (period) {
        periodEl.textContent = browser.i18n.getMessage(period.labelI18nKey, [String(period.count)]);
        // The rounded phrase is the headline; the exact start date stays reachable on hover.
        periodEl.title = new Date(firstSeen).toLocaleString();
    } else {
        periodEl.textContent = "";
        periodEl.removeAttribute("title");
    }
    periodEl.classList.toggle("hidden", !period);
};

/**
 * Renders the historical tally for one site. The rows carry no threshold zone: the tally spans the
 * whole life of the record, over which the threshold can have moved any number of times, so
 * colouring it by today's setting would claim something about the past that was never true.
 */
const _refreshStatsView = ({ domain, cumulativeStats }) => {
    const stats = cumulativeStats || {};
    const { shown, maxCount, totalFound } = summarizeLevels(
        stats.groupedByClickbaitiness, stats.convertedByClickbaitiness, Clickbaitiness.LEVELS);

    _refreshStatsHeader(stats.firstSeen);

    // A record that started counting the per-level converted titles after it started counting the
    // rest describes less history in them, so any share drawn from it would read low. Such a record
    // gets bars of plain magnitude until one collects both from the start.
    const rewrittenIsKnown = stats.convertedByClickbaitiness != null &&
        stats.convertedByClickbaitinessSince == null;

    const hasData = totalFound > 0 || (stats.convertedCount || 0) > 0;
    const body = document.getElementById("statsview-body");
    if (body) {
        body.classList.toggle("hidden", !hasData);
    }

    const emptyEl = document.getElementById("statsview-empty");
    if (emptyEl) {
        // An unsupported site is a dead end; a supported one with nothing counted just needs time.
        emptyEl.textContent = browser.i18n.getMessage(
            domain ? "statsviewNoData" : "homeviewStatusNotSupported");
        emptyEl.classList.toggle("hidden", hasData);
    }

    const convertedEl = document.getElementById("statsview-converted-count");
    if (convertedEl) {
        convertedEl.textContent = String(stats.convertedCount || 0);
    }

    // Both tallies count the same stream of found titles, so the share between them is real. It is
    // still only stated when the arithmetic holds, rather than trusting that it always will.
    const ofEl = document.getElementById("statsview-converted-of");
    if (ofEl) {
        const converted = stats.convertedCount || 0;
        const comparable = totalFound > 0 && converted <= totalFound;
        ofEl.textContent = comparable
            ? browser.i18n.getMessage("statsviewConvertedOfFound",
                [String(totalFound), String(Math.round((converted / totalFound) * 100))])
            : "";
        ofEl.classList.toggle("hidden", !comparable);
    }

    const statsList = document.getElementById("statistics-grouped-by-clickbaitiness");
    if (statsList) {
        statsList.replaceChildren();

        for (const row of shown) {
            statsList.appendChild(_createStatRow(row.level, row.count, {
                maxCount,
                rewritten: rewrittenIsKnown ? row.rewritten : undefined
            }));
        }
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
        browser.i18n.getMessage("settingsviewSitesEnabledTitle");
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
        
        indicator.textContent = labelKey ? browser.i18n.getMessage(labelKey) : "";
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
        settingsviewStatusTitle.textContent = browser.i18n.getMessage("settingsviewStatusTitle");
    }
    // settingsview-extension-enabled state and label are managed by the master-switch-setting component

    // Update settings view clickbait level section
    const settingsviewClickbaitLevelTitle = document.getElementById("settingsview-clickbait-level-title");
    if (settingsviewClickbaitLevelTitle) {
        settingsviewClickbaitLevelTitle.textContent = browser.i18n.getMessage("settingsviewClickbaitLevelTitle");
    }
    // settingsview-clickbait-level is managed by the clickbait-level-horizontal component

    // Update settings view database status section title
    const dbTitleEl = document.getElementById("settingsview-database-status-title");
    if (dbTitleEl) {
        dbTitleEl.textContent = browser.i18n.getMessage("settingsviewDatabaseStatusTitle");
    }
    // database-last-updated, database-generation-date, and update-database-btn states are managed by the database-status-setting component

    const clickbaitLevelThreshold = await model.read.getClickbaitLevel();

    _refreshSettingsView({
        isConversionEnabled,
        isDevelopmentEnv,
        config,
    });
    _refreshHomeView({
        site: pageHostname,
        pageStats: cachedPageStats,
        isSiteEnabled: matchingDomain ? isCurrentSiteEnabled : undefined,
        clickbaitLevelThreshold,
    });
    _refreshStatsView({
        domain: matchingDomain,
        cumulativeStats,
    });

    // Load conversions list in feedback view

    const noConversionsEl = document.getElementById("feedbackview-no-conversions");
    const conversionsListEl = document.getElementById("feedbackview-conversions-list");

    let conversions = [];
    const tab = await getActiveTab();
    if (tab) {
        try {
            conversions = await browser.tabs.sendMessage(tab.id, { 
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
                    noConversionsEl.textContent = browser.i18n.getMessage("feedbackviewNoConversions");
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

                const expandoBtnText = browser.i18n.getMessage("feedbackviewShowBelowThresholdBtn", [underThresholdConversions.length]) || `Näytä klikkikynnyksen alittavat otsikot (${underThresholdConversions.length})`;

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
                    expandoBtn.style.background = "var(--color-surface-hover)";
                    expandoArrow.style.transform = "rotate(180deg)";
                    expandoContent.classList.remove("hidden");
                } else {
                    expandoBtn.style.background = "var(--color-surface-muted)";
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
                        expandoBtn.style.background = "var(--color-surface-hover)";

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
                        expandoBtn.style.background = "var(--color-surface-muted)";
                    }
                });

                conversionsListEl.appendChild(expandoContainer);
            }
        }
    }

    document.getElementById("navi-main").parentElement.title =
        browser.i18n.getMessage("navigationMainLabel");
    document.getElementById("navi-stats").parentElement.title =
        browser.i18n.getMessage("navigationStatsLabel");
    document.getElementById("navi-feedback").parentElement.title =
        browser.i18n.getMessage("navigationFeedbackLabel");
    document.getElementById("navi-settings").parentElement.title =
        browser.i18n.getMessage("navigationSettingsLabel");
    document.getElementById("open-options").title =
        browser.i18n.getMessage("navigationSettingsLabel");

    document.querySelector("label[for=enable-devmode] span").title =
        browser.i18n.getMessage("devmodeHiddenButtonTitle");
    document.querySelector("label[for=copy-link-signatures]").title =
        browser.i18n.getMessage("devmodeCopyLinkSignaturesTitle");

    const settingsviewDevmodeTitle = document.getElementById("settingsview-devmode-title");
    if (settingsviewDevmodeTitle) {
        settingsviewDevmodeTitle.textContent = browser.i18n.getMessage("settingsviewDevmodeTitle");
    }
    const devmodeDumpLinkHashLabel = document.getElementById("devmode-dumpLinkHash-label");
    if (devmodeDumpLinkHashLabel) {
        devmodeDumpLinkHashLabel.textContent = browser.i18n.getMessage("devmodeDumpLinkHashLabel");
    }
    const devmodeDumpLinkHashBtn = document.getElementById("devmode-dumpLinkHash");
    if (devmodeDumpLinkHashBtn) {
        devmodeDumpLinkHashBtn.textContent = browser.i18n.getMessage("devmodeDumpLinkHashBtn");
    }
    const openOptionsBtn = document.getElementById("open-options-btn");
    if (openOptionsBtn) {
        openOptionsBtn.textContent = browser.i18n.getMessage("preferencesViewMoreSettingsBtn");
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
    const tab = await getActiveTab();
    if (tab) {
        try {
            window.contentPort = browser.tabs.connect(tab.id, { name: "paatti-popup-direct" });
            window.contentPort.onMessage.addListener(async (msg) => {
                if (msg && msg.action === "pageStatsUpdated") {
                    log("Received live pageStats from content script:", msg.pageStats);
                    cachedPageStats = msg.pageStats;
                    const pageHostname = await getCurrentTabHostname();
                    const matchingDomain = await model.read.getMatchingSiteDomain(pageHostname);
                    const isCurrentSiteEnabled = matchingDomain ? await isSiteEnabled(matchingDomain) : false;
                    const clickbaitLevelThreshold = await model.read.getClickbaitLevel();
                    _refreshHomeView({
                        site: pageHostname,
                        pageStats: cachedPageStats,
                        isSiteEnabled: matchingDomain ? isCurrentSiteEnabled : undefined,
                        clickbaitLevelThreshold,
                    });
                }
            });
        } catch (err) {
            log("Content script not ready to receive connection:", err);
        }
    }

    // Close open stats row details on document click outside stats rows
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".stats-row")) {
            document.querySelectorAll(".stats-row.is-open").forEach((row) => {
                row.classList.remove("is-open");
                const btn = row.querySelector(".stats-dot-btn");
                if (btn) btn.setAttribute("aria-expanded", "false");
                const details = row.querySelector(".stats-row-details");
                if (details) details.classList.add("hidden");
            });
        }
    });

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
            browser.runtime.openOptionsPage();
            window.close();
        });

    const openOptionsBtnEl = document.getElementById("open-options-btn");
    if (openOptionsBtnEl) {
        openOptionsBtnEl.addEventListener("click", () => {
            browser.runtime.openOptionsPage();
            window.close();
        });
    }

    const requestSiteBtn = document.getElementById("request-site-btn");
    if (requestSiteBtn) {
        requestSiteBtn.addEventListener("click", async () => {
            const hostname = await getCurrentTabHostname();
            const url = `https://github.com/klikkikuri/paatti/issues?q=is%3Aissue+${encodeURIComponent(hostname)}`;
            browser.tabs.create({ url });
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

// Everything the popup renders out of the config, flat so it compares exactly.
onConfigValue(
    (config) => [
        config.enabled,
        config.activeEnv,
        config.clickbaitLevel,
        ...Object.values(config.siteConfigs).map((site) => site.enabled)
    ],
    view.refresh
);

// Statistics are their own local key, written by the content script and the worker,
// so they never reach the popup through the config.
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !("statistics" in changes)) return;
    view.refresh();
});

// Listen for page scroll events sent from the content script and refresh the popup content.
browser.runtime.onMessage.addListener((message) => {
    if (message.action === "pageScrolled") {
        // Prevent refreshing if the user has an active feedback typing form open.
        // We query for .feedback-input-container since that is used by feedback-item components.
        const activeFeedbackForm = document.querySelector(".feedback-input-container:not(.hidden)");
        if (!activeFeedbackForm) {
            view.refresh();
        }
    }
});

