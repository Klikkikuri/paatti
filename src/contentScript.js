"use strict";



// Use this to access this source file in the browser debugger.
//debugger;

const LABEL_PAYWALLED = "com.github.klikkikuri/paywalled=true";

let hrefSign;

// Main.
(async () => {
    ////////////////////////////////////////////////////////////////////////////
    // Import modules.
    // Resolved inline, not imported: this file needs runtime.getURL() before it can import browser-api.js.
    const browser = globalThis.browser ?? globalThis.chrome;
    const { model: model, klikkikuriStatus: klikkikuriStatus } = await import(browser.runtime.getURL("src/model.js"));
    const { controller } = await import(browser.runtime.getURL("src/controller.js"));
    const { getLogger, debounce, canAppendSpan } = await import(browser.runtime.getURL("src/utils.js"));

    const { createHighlightOverlay } = await import(browser.runtime.getURL("src/components/highlight-overlay.js"));
    const { createFeedbackDialog } = await import(browser.runtime.getURL("src/components/feedback-dialog.js"));
    const { getConfig } = await import(browser.runtime.getURL("src/config.js"));

    const { rahtiStorage } = await import(browser.runtime.getURL("src/rahti.js"));
    const { applyModifiers } = await import(browser.runtime.getURL("src/modifiers.js"));
    const { buildPageSnapshot, createSessionTracker } = await import(browser.runtime.getURL("src/stats.js"));

    // Inject Web Components into page's main world context
    const badgeComponents = [
        "src/components/klikkikuri-ai-badge.js",
        "src/components/klikkikuri-video-badge.js"
    ];
    for (const componentPath of badgeComponents) {
        try {
            const scriptElem = document.createElement("script");
            scriptElem.type = "module";
            scriptElem.src = browser.runtime.getURL(componentPath);
            (document.head || document.documentElement).appendChild(scriptElem);
        } catch (e) {
            // Fallback for isolated environment
            await import(browser.runtime.getURL(componentPath));
        }
    }

    const log = getLogger("content_script");

    /** The converted title lives on the container's title element, or on the container itself. */
    const convertedTitleOf = (element) =>
        (element.querySelector("[data-klikkikuri-original-title]") || element).dataset.klikkikuriConvertedTitle;

    // Reports on a conversion, in the page, in a shadow root of its own. The popup cannot be opened from here.
    const feedbackDialog = createFeedbackDialog({
        browser,
        log,
        getFeedbackServerUrl: async () => {
            try {
                const config = await getConfig();
                if (config?.feedbackServerUrl) return config.feedbackServerUrl;
            } catch (err) {
                log("Error loading config for feedback server URL:", err);
            }
            return "https://api.klikkikuri.fi/v1/feedback";
        },
        getDatabaseUpdated: async () => {
            const status = await model.read.getDatabaseStatus();
            return status.lastDatabaseUpdate ? new Date(status.lastDatabaseUpdate).toISOString() : "Unknown";
        }
    });

    // Draws the debug outlines and the popup's hover highlight, in a shadow root of its own.
    const highlightOverlay = createHighlightOverlay({
        canActivate: (element) => Boolean(convertedTitleOf(element)),
        onLabelActivate: (element) => feedbackDialog.open(element)
    });

    /**
     * Returns the favicon URL the browser would use for this page:
     * first <link rel="icon"> found, falling back to /favicon.ico.
     *
     * @returns {string} Absolute URL of the page favicon.
     */
    const extractFaviconUrl = () => {
        const link = document.querySelector('link[rel~="icon"]');
        return link?.href ?? `${window.location.protocol}//${window.location.host}/favicon.ico`;
    };

    // Dispatch favicon URL to background for caching. Non-blocking, non-fatal.
    browser.runtime.sendMessage({
        action: "storeFavicon",
        domain: window.location.hostname,
        url: extractFaviconUrl()
    }).catch((err) => {
        log("storeFavicon message failed (non-fatal):", err);
    });

    hrefSign = async (url) => {
        try {
            const urlObj = new URL(url, window.location.href);
            const response = await browser.runtime.sendMessage({ action: "hashUrls", urls: [urlObj.href] });
            if (response && response.success && response.hashes) {
                return response.hashes[urlObj.href];
            }
        } catch (err) {
            log("Error generating signature for single URL:", err);
        }
        return null;
    };

    let isPopupOpen = false;

    const updateEnvironmentClass = async () => {
        try {
            const env = await model.read.getEnvironment();
            const documentElement = document.documentElement;
            if (documentElement) {
                for (const className of Array.from(documentElement.classList)) {
                    if (className.startsWith("klikkikuri-env-")) {
                        documentElement.classList.remove(className);
                    }
                }
                documentElement.classList.add(`klikkikuri-env-${env}`);
            }
        } catch (e) {
            log("Failed to update environment class", e);
        }
    };

    const updateVisualHighlightClass = async () => {
        try {
            const documentElement = document.documentElement;
            if (documentElement) {
                const enabled = await model.read.getVisualHighlightEnabled();
                if (enabled || isPopupOpen) {
                    documentElement.classList.add("klikkikuri-visual-hilight");
                } else {
                    documentElement.classList.remove("klikkikuri-visual-hilight");
                }
                // The class drives no styling any more; it stays as a signal that the mode is on.
                const visible = enabled || isPopupOpen;
                highlightOverlay.setStatusVisible(visible);
                // The dialog is opened from a status label, so it must not outlive the labels.
                if (!visible) {
                    feedbackDialog.close();
                }
            }
        } catch (e) {
            log("Failed to update visual highlight class", e);
        }
    };

    await updateEnvironmentClass();
    await updateVisualHighlightClass();

    // Listen for storage changes to toggle the class dynamically
    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.visualHighlightEnabled) {
            updateVisualHighlightClass();
        }
    });

    ////////////////////////////////////////////////////////////////////////////
    // Global state.

    const rahti = await rahtiStorage;
    const newsSite = window.location.hostname;
    const matchingDomain = await model.read.getMatchingSiteDomain(newsSite);
    const sessionTracker = createSessionTracker();

    let lastPageSnapshot = null;
    let activePort = null;

    ////////////////////////////////////////////////////////////////////////////
    // Initialization.

    // Listen for popup direct connection to manage visibility styling, highlighting, and live stats push
    browser.runtime.onConnect.addListener((port) => {
        if (port.name === "paatti-popup-direct") {
            log("Popup connection established, adding visible class.");
            activePort = port;
            document.body.classList.add("paatti-popup-visible");
            isPopupOpen = true;
            updateVisualHighlightClass();

            // Push current snapshot if one has already been computed
            if (lastPageSnapshot) {
                try {
                    port.postMessage({
                        action: "pageStatsUpdated",
                        pageStats: lastPageSnapshot
                    });
                } catch (e) {
                    log("Failed to post initial pageStats to popup port:", e);
                }
            }

            port.onDisconnect.addListener(() => {
                log("Popup connection closed, removing visible class.");
                activePort = null;
                document.body.classList.remove("paatti-popup-visible");
                isPopupOpen = false;
                updateVisualHighlightClass();

                // Clear any hover highlights when popup is closed
                highlightOverlay.clearHovered();
            });
        }
    });

    if (!rahti) {
        log("No Rahti data found, aborting conversion.", rahti);
        return;
    } else {
        log("Rahti data loaded, starting conversion procedure.", rahti);
    }

    ////////////////////////////////////////////////////////////////////////////
    // Processing subroutines.

    const processSite = async () => {
        const startTime = performance.now();

        // Get site rules
        const siteRules = await model.read.getSiteRules(newsSite);
        if (!siteRules) {
            log(`No site rules found for '${newsSite}', aborting conversion.`);
            return;
        }

        // Scan and collect elements to process
        const linksToProcess = [];
        const matchedContainers = new Set();
        for (const rule of siteRules) {
            const containers = document.querySelectorAll(rule.container);
            for (const container of containers) {
                matchedContainers.add(container);
                const links = (!rule.link || rule.link === "self" || rule.link === ":scope")
                    ? [container]
                    : container.querySelectorAll(rule.link);
                for (const link of links) {
                    const titleElem = (rule.title === "self" || rule.title === ":scope")
                        ? container
                        : (rule.title ? container.querySelector(rule.title) : link);

                    if (!titleElem) {
                        container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                        container.dataset.klikkikuriReason = `No title element found for selector '${rule.title}'`;
                        continue;
                    }

                    const href = link.getAttribute('href');
                    if (href) {
                        try {
                            const urlObj = new URL(href, window.location.href);
                            linksToProcess.push({ container, link, rule, href: urlObj.href, titleElem });
                        } catch (e) {
                            // ignore invalid URL
                        }
                    } else {
                        container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                        container.dataset.klikkikuriReason = "Link has no href attribute";
                    }
                }
            }
        }

        // Batch generate signatures from background service worker
        const uniqueUrls = Array.from(new Set(linksToProcess.map(x => x.href)));
        let urlHashes = {};
        if (uniqueUrls.length > 0) {
            try {
                const response = await browser.runtime.sendMessage({ action: "hashUrls", urls: uniqueUrls });
                if (response && response.success) {
                    urlHashes = response.hashes;
                } else {
                    log("Batch hashing failed:", response?.error);
                }
            } catch (err) {
                log("Failed to communicate with background for hashing:", err);
            }
        }

        // Process each element using pre-computed hashes
        const processingPromises = linksToProcess.map(async ({ container, link, rule, href, titleElem }) => {
            let what = klikkikuriStatus.SKIPPED;
            let why = "";
            let how = "";
            let clickbaitiness = null;
            let urlSign = null;

            try {
                urlSign = urlHashes[href];
                if (!urlSign) {
                    why = `Failed to generate signature for URL '${href}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    container.dataset.klikkikuriReason = why;
                    return { what, why, how, clickbaitiness, urlSign: null };
                }
                container.dataset.klikkikuriUrlSign = urlSign;

                const rahtiEntry = await rahti.get(urlSign);
                if (!rahtiEntry) {
                    why = `No Rahti entry found for hash '${urlSign}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    container.dataset.klikkikuriReason = why;
                    return { what, why, how, clickbaitiness };
                }

                clickbaitiness = rahtiEntry.clickbaitiness;
                titleElem.dataset.klikkikuriClickbaitLevel = rahtiEntry.clickbaitiness;

                if (!titleElem.dataset.klikkikuriOriginalTitle) {
                    titleElem.dataset.klikkikuriOriginalTitle = titleElem.textContent;
                }

                if (rahtiEntry.title) {
                    titleElem.dataset.klikkikuriConvertedTitle = rahtiEntry.title;
                } else {
                    delete titleElem.dataset.klikkikuriConvertedTitle;
                }

                if (rahtiEntry.labels && rahtiEntry.labels.length > 0) {
                    container.dataset.klikkikuriLabels = rahtiEntry.labels.join(",");
                } else {
                    delete container.dataset.klikkikuriLabels;
                }

                const isSiteEnabled = await model.read.isEnabled(newsSite);
                const hasConvertedTitle = !!rahtiEntry.title;
                const shouldConvert = hasConvertedTitle && await model.read.shouldConvert(rahtiEntry.clickbaitiness);

                let titleText = "";
                if (isSiteEnabled && shouldConvert) {
                    what = "converted";
                    why = rahtiEntry.clickbaitiness;
                    titleText = rahtiEntry.title;

                    container.dataset.klikkikuriStatus = klikkikuriStatus.CONVERTED;
                    container.dataset.klikkikuriReason = `Converted (Clickbaitiness level: ${why})`;
                } else {
                    const isPaywalled = !hasConvertedTitle && rahtiEntry.labels && rahtiEntry.labels.includes(LABEL_PAYWALLED);
                    what = isPaywalled ? "paywalled" : "original";
                    why = !isSiteEnabled 
                        ? `Conversion not enabled for site '${newsSite}'` 
                        : !hasConvertedTitle
                        ? `No converted title in dataset`
                        : `Clickbaitiness level for '${rahtiEntry.clickbaitiness}' is below threshold`;
                    titleText = titleElem.dataset.klikkikuriOriginalTitle;

                    container.dataset.klikkikuriStatus = isPaywalled ? klikkikuriStatus.PAYWALLED : klikkikuriStatus.ORIGINAL;
                    container.dataset.klikkikuriReason = why;
                }

                // Apply registered title modifiers (e.g. AI marking)
                const modifierResult = await applyModifiers(titleText, rahtiEntry);
                let modifiedTitle = titleText;
                let badges = [];

                if (typeof modifierResult === "string") {
                    modifiedTitle = modifierResult;
                } else if (modifierResult && typeof modifierResult === "object") {
                    modifiedTitle = modifierResult.text ?? titleText;
                    badges = modifierResult.badges || [];
                }

                if (badges.length > 0) {
                    if (canAppendSpan(titleElem)) {
                        const children = [];
                        for (const b of badges) {
                            if (!b.tagName) continue;
                            const badgeElem = document.createElement(b.tagName);
                            if (b.badgeText) {
                                badgeElem.setAttribute("label", b.badgeText);
                            }
                            if (b.tooltip) {
                                badgeElem.setAttribute("tooltip", b.tooltip);
                                badgeElem.setAttribute("title", b.tooltip);
                            }
                            children.push(badgeElem);
                        }
                        children.push(document.createTextNode(modifiedTitle));
                        titleElem.replaceChildren(...children);
                        how = titleElem.textContent;
                    } else {
                        const badgePrefix = badges.map((b) => b.badgeText).join("");
                        how = (titleElem.textContent = badgePrefix + modifiedTitle);
                    }
                } else {
                    how = (titleElem.textContent = modifiedTitle);
                }
            } catch (err) {
                what = "error";
                why = err.message || String(err);
                how = err.stack || "";
                log(`Error processing title element: ${why}`, err, link);

                container.dataset.klikkikuriStatus = klikkikuriStatus.ERROR;
                container.dataset.klikkikuriReason = why;
            }

            // Return classifications for gathering stats.
            return {
                what,
                why,
                how,
                clickbaitiness,
                urlSign,
                originalTitle: titleElem?.dataset?.klikkikuriOriginalTitle
            };
        });

        // Safely collect results without crashing the entire flow if a promise rejects
        const settledPromises = await Promise.allSettled(processingPromises);
        const reasons = [];
        const errors = [];

        for (const result of settledPromises) {
            if (result.status === "fulfilled") {
                reasons.push(result.value);
            } else {
                errors.push(result.reason);
                log("Promise rejected during conversion execution:", result.reason);
            }
        }

        const duration = performance.now() - startTime;
        const stats = reasons.reduce(
            (acc, item) => {
                acc[item.what] = (acc[item.what] || 0) + 1;
                return acc;
            },
            { converted: 0, original: 0, skipped: 0, error: errors.length }
        );

        // Build live page snapshot from all reasons currently on page
        const pageSnapshot = buildPageSnapshot(reasons);
        lastPageSnapshot = pageSnapshot;

        // Push live page snapshot to popup if direct port connection is active
        if (activePort) {
            try {
                activePort.postMessage({
                    action: "pageStatsUpdated",
                    pageStats: pageSnapshot
                });
            } catch (e) {
                log("Failed to push pageStats to popup port:", e);
            }
        }

        // Persist newly discovered items into cumulative statistics for matching siteConfig domain
        if (matchingDomain) {
            const unseenReasons = sessionTracker.getDelta(reasons);
            const delta = buildPageSnapshot(unseenReasons);
            if (Object.keys(delta.groupedByClickbaitiness).length > 0) {
                await controller.updateStatistics({
                    domain: matchingDomain,
                    delta
                });
            }
        }

        // Statuses are sticky — nothing else ever removes one — so a container the page has recycled for new
        // content would keep a status that no longer describes it. Drop the ones this pass did not match.
        // Deliberately not klikkikuriHighlightId: getConversions mints it and a hover in flight reads it.
        for (const element of document.querySelectorAll("[data-klikkikuri-status]")) {
            if (matchedContainers.has(element)) continue;
            delete element.dataset.klikkikuriStatus;
            delete element.dataset.klikkikuriReason;
        }

        highlightOverlay.refresh();

        log(`Finished conversion procedure on '${newsSite}' in ${duration.toFixed(2)}ms. Stats:`, stats);

        const matchesCount = stats.converted + stats.original;
        if (matchesCount > 0) {
            log(`[Debug] Page processed with ${matchesCount} matching clickbait entries.`);
        } else {
            if (siteRules) {
                if (reasons.length === 0) {
                    log(`[Debug] Page '${newsSite}' is supported, but no elements matching site rules were found on the page.`);
                } else {
                    log(`[Debug] Page '${newsSite}' is supported, but none of the ${reasons.length} processed elements matched clickbait entries.`);
                }
            }
        }
    };

    const debouncedProcessSite = debounce(async () => {
        try {
            await processSite();
        } catch (e) {
            log("Error during conversion after DOM mutation:", e);
        }
    }, 150);

    const observer = new MutationObserver((mutations) => {
        // Check if extension context was invalidated (e.g. extension updated/reloaded)
        if (!browser.runtime?.id) {
            log("Extension context is invalidated. Disconnecting MutationObserver.");
            observer.disconnect();
            return;
        }

        // Use original title as the flag, as a converted title would be
        // removed when restoring page to show original titles.
        const isInternalChange = mutations.every(mutation =>
            mutation.target.dataset?.klikkikuriOriginalTitle ||
            mutation.target.parentElement?.dataset?.klikkikuriOriginalTitle
        );
        if (isInternalChange) {
            return;
        }

        log(`Observed ${mutations.length} DOM mutations, scheduling conversion.`);
        debouncedProcessSite();
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false // Ignore attribute changes to prevent loop from setAttribute
    });

    function isElementVisibleInViewport(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return false;
        }
        const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
        const viewWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
        return !(rect.bottom < 0 || rect.top > viewHeight || rect.right < 0 || rect.left > viewWidth);
    }

    // Set up communication between content script and rest of extension (e.g., the popup).
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log(`Received message '${JSON.stringify(message)}' on '${newsSite}'`);

        switch (message.command) {
            case "convertClickbaits":
                processSite()
                    .then(() => sendResponse({ success: true }))
                    .catch((err) => {
                        log("Error processing site:", err);
                        sendResponse({ success: false, error: err.message });
                    });
                return true;
            case "devmode_generateLinkSignatures": {
                const links = Array.from(document.querySelectorAll("a"));
                const signaturePromises = links.map((x) => hrefSign(x.href));
                Promise.all(signaturePromises)
                    .then((result) => sendResponse(result))
                    .catch((err) => {
                        log("Error generating link signatures:", err);
                        sendResponse([]);
                    });
                return true;
            }
            case "getConversions": {
                (async () => {
                    const onlyVisible = message.onlyVisible;
                    const containers = Array.from(document.querySelectorAll("[data-klikkikuri-status='converted'], [data-klikkikuri-status='original']"));
                    const results = [];
                    const seen = new Map();
                    let counter = 0;
                    for (const container of containers) {
                        const status = container.dataset.klikkikuriStatus;
                        const titleElem = container.querySelector("[data-klikkikuri-original-title]") || container;
                        const convertedTitle = titleElem.dataset.klikkikuriConvertedTitle || "";

                        // Only include "original" status elements if they actually have a conversion in the dataset
                        if (status === "original" && !convertedTitle) {
                            continue;
                        }

                        // For under-threshold items, we only want ones in the viewport (visible)
                        if (status === "original" && !isElementVisibleInViewport(container)) {
                            continue;
                        }

                        if (onlyVisible && !isElementVisibleInViewport(container)) {
                            continue;
                        }

                        const urlSign = container.dataset.klikkikuriUrlSign || "";
                        const originalTitle = titleElem.dataset.klikkikuriOriginalTitle || titleElem.textContent || "";
                        const clickbaitLevel = titleElem.dataset.klikkikuriClickbaitLevel || "";

                        const key = urlSign || originalTitle;
                        let highlightId;
                        if (seen.has(key)) {
                            highlightId = seen.get(key);
                            container.dataset.klikkikuriHighlightId = highlightId;
                        } else {
                            highlightId = `kk-hl-${counter++}`;
                            seen.set(key, highlightId);
                            container.dataset.klikkikuriHighlightId = highlightId;
                            results.push({
                                highlightId,
                                urlSign,
                                originalTitle,
                                convertedTitle,
                                clickbaitLevel,
                                isUnderThreshold: (status === "original")
                            });
                        }
                    }

                    if (rahti) {
                        try {
                            const pageUrl = window.location.href;
                            const pageSign = await hrefSign(pageUrl);
                            if (pageSign) {
                                const pageRahtiEntry = await rahti.get(pageSign);
                                if (pageRahtiEntry) {
                                    const pageOriginalTitle = document.querySelector("h1")?.textContent?.trim() || document.title;
                                    const h1 = document.querySelector("h1");
                                    const highlightId = `kk-hl-main`;
                                    if (h1) {
                                        h1.dataset.klikkikuriHighlightId = highlightId;
                                    }
                                    results.unshift({
                                        highlightId,
                                        urlSign: pageSign,
                                        originalTitle: pageOriginalTitle,
                                        convertedTitle: pageRahtiEntry.title,
                                        clickbaitLevel: pageRahtiEntry.clickbaitiness,
                                        isMainPage: true
                                    });
                                }
                            }
                        } catch (err) {
                            log("Error checking current page URL signature:", err);
                        }
                    }

                    return results;
                })()
                .then((results) => sendResponse(results))
                .catch((err) => {
                    log("Error in getConversions:", err);
                    sendResponse([]);
                });
                return true;
            }
            case "highlightElement": {
                highlightOverlay.addHovered(document.querySelectorAll(`[data-klikkikuri-highlight-id="${message.highlightId}"]`));
                break;
            }
            case "unhighlightElement": {
                highlightOverlay.removeHovered(document.querySelectorAll(`[data-klikkikuri-highlight-id="${message.highlightId}"]`));
                break;
            }
            case "clearAllHighlights": {
                highlightOverlay.clearHovered();
                break;
            }
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    // Run the conversion on reload.
    try {
        await processSite();
    } catch (e) {
        log("Failed on page load -conversion:", e);
    }

    // Send a message to the popup when the user scrolls the page.
    window.addEventListener("scroll", debounce(() => {
        if (browser.runtime?.id) {
            browser.runtime.sendMessage({ action: "pageScrolled" }).catch((err) => {
                // Ignore error when popup/background is not listening.
            });
        }
    }, 200));

    log("Loaded");
})();
