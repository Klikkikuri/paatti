"use strict";



// Use this to access this source file in the browser debugger.
//debugger;

const LABEL_PAYWALLED = "com.github.klikkikuri/paywalled=true";

let hrefSign;

// Main.
(async () => {
    ////////////////////////////////////////////////////////////////////////////
    // Import modules.
    const browser = (typeof chrome !== "undefined" ? chrome : globalThis.browser);
    const { model: model, modelEvents: modelEvents, klikkikuriStatus: klikkikuriStatus } = await import(browser.runtime.getURL("src/model.js"));
    const { controller } = await import(browser.runtime.getURL("src/controller.js"));
    const { getLogger, debounce } = await import(browser.runtime.getURL("src/utils.js"));

    const { rahtiStorage } = await import(browser.runtime.getURL("src/rahti.js"));

    const log = getLogger("content_script");

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

    await model.events.removeEventListener(modelEvents.enabledChange, controller.dispatchConversion);

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
            const data = await browser.storage.local.get("visualHighlightEnabled");
            const documentElement = document.documentElement;
            if (documentElement) {
                const debugVisuals = await model.read.isDebugVisualsEnabled();
                const enabled = data.hasOwnProperty("visualHighlightEnabled")
                    ? !!data.visualHighlightEnabled
                    : debugVisuals;
                if (enabled || isPopupOpen) {
                    documentElement.classList.add("klikkikuri-visual-hilight");
                } else {
                    documentElement.classList.remove("klikkikuri-visual-hilight");
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

    ////////////////////////////////////////////////////////////////////////////
    // Initialization.

    // Listen for popup direct connection to manage visibility styling and highlighting
    browser.runtime.onConnect.addListener((port) => {
        if (port.name === "paatti-popup-direct") {
            log("Popup connection established, adding visible class.");
            document.body.classList.add("paatti-popup-visible");
            isPopupOpen = true;
            updateVisualHighlightClass();

            port.onDisconnect.addListener(() => {
                log("Popup connection closed, removing visible class.");
                document.body.classList.remove("paatti-popup-visible");
                isPopupOpen = false;
                updateVisualHighlightClass();

                // Clear any hover highlights when popup is closed
                const highlightedElements = document.querySelectorAll(".klikkikuri-hover-highlight");
                for (const el of highlightedElements) {
                    el.classList.remove("klikkikuri-hover-highlight");
                }
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

    /*
     * Parallelly iterate through all the title elements according to site's rules. 
     * @param  {Function(siteRule, ruleContainer, ruleLink) -> Promise} f
     * Function that processes a single title elem derivable from the
     * parameters.
     * @return {Array[Promise]} Array of all the calls to f.
     */
    const processTitleElems = async (f) => {
        const siteRules = await model.read.getSiteRules(newsSite);
        if (!siteRules) {
            log(`No site rules found for '${newsSite}', aborting conversion.`);
            return [];
        }

        const processingPromises = [];
        for (const rule of siteRules) {
            const containers = document.querySelectorAll(rule.container);
            for (const container of containers) {
                const links = (!rule.link || rule.link === "self" || rule.link === ":scope")
                    ? [container]
                    : container.querySelectorAll(rule.link);
                for (const link of links) {
                    processingPromises.push(f(rule, container, link));
                }
            }
        }
        return processingPromises;
    };

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
        for (const rule of siteRules) {
            const containers = document.querySelectorAll(rule.container);
            for (const container of containers) {
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

            try {
                const urlSign = urlHashes[href];
                if (!urlSign) {
                    why = `Failed to generate signature for URL '${href}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    container.dataset.klikkikuriReason = why;
                    return { what, why, how, clickbaitiness };
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

                if (isSiteEnabled && shouldConvert) {
                    what = "converted";
                    why = rahtiEntry.clickbaitiness;
                    how = (titleElem.textContent = rahtiEntry.title);

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
                    how = (titleElem.textContent = titleElem.dataset.klikkikuriOriginalTitle);

                    container.dataset.klikkikuriStatus = isPaywalled ? klikkikuriStatus.PAYWALLED : klikkikuriStatus.ORIGINAL;
                    container.dataset.klikkikuriReason = why;
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
            return { what, why, how, clickbaitiness };
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

        await controller.updateStatistics({
            hostname: newsSite,
            siteStats: {
                groupedByClickbaitiness: reasons
                    .map((x) => x.clickbaitiness)
                    .filter((x) => x !== null && x !== undefined)
                    .reduce((acc, x) => {
                        if (acc[x] === undefined) {
                            acc[x] = 0;
                        }
                        acc[x] += 1;
                        return acc;
                    }, {}),
            },
        });

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
        const browserObj = (typeof chrome !== "undefined" ? chrome : globalThis.browser);
        if (!browserObj || !browserObj.runtime || !browserObj.runtime.id) {
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
                    const containers = Array.from(document.querySelectorAll("[data-klikkikuri-status='converted']"));
                    const results = [];
                    const seen = new Map();
                    let counter = 0;
                    for (const container of containers) {
                        if (onlyVisible && !isElementVisibleInViewport(container)) {
                            continue;
                        }
                        const titleElem = container.querySelector("[data-klikkikuri-original-title]") || container;
                        const urlSign = container.dataset.klikkikuriUrlSign || "";
                        const originalTitle = titleElem.dataset.klikkikuriOriginalTitle || titleElem.textContent || "";
                        const convertedTitle = titleElem.dataset.klikkikuriConvertedTitle || "";
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
                                clickbaitLevel
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
                const els = document.querySelectorAll(`[data-klikkikuri-highlight-id="${message.highlightId}"]`);
                for (const el of els) {
                    el.classList.add("klikkikuri-hover-highlight");
                }
                break;
            }
            case "unhighlightElement": {
                const els = document.querySelectorAll(`[data-klikkikuri-highlight-id="${message.highlightId}"]`);
                for (const el of els) {
                    el.classList.remove("klikkikuri-hover-highlight");
                }
                break;
            }
            case "clearAllHighlights": {
                const els = document.querySelectorAll(".klikkikuri-hover-highlight");
                for (const el of els) {
                    el.classList.remove("klikkikuri-hover-highlight");
                }
                break;
            }
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    // Expose developer debug helpers on window object.
    window.__klikkikuri_debug = {
        newsSite,
        processSite,
        rahti,
        getStats: () => {
            const elements = document.querySelectorAll("[data-klikkikuri-status]");
            const stats = { converted: 0, original: 0, skipped: 0, error: 0 };
            elements.forEach(el => {
                const status = el.dataset.klikkikuriStatus;
                if (status in stats) {
                    stats[status]++;
                }
            });
            return stats;
        },
        getElements: (statusFilter) => {
            const elements = Array.from(document.querySelectorAll("[data-klikkikuri-status]"));
            return elements
                .filter(el => !statusFilter || el.dataset.klikkikuriStatus === statusFilter)
                .map(el => ({
                    element: el,
                    status: el.dataset.klikkikuriStatus,
                    reason: el.dataset.klikkikuriReason,
                    hash: el.dataset.klikkikuriUrlSign || el.dataset.klikkikuriUrlHash || el.querySelector("a")?.dataset.klikkikuriUrlSign || el.querySelector("a")?.dataset.klikkikuriUrlHash,
                    text: el.textContent
                }));
        }
    };

    // Run the conversion on reload.
    try {
        await processSite();
    } catch (e) {
        log("Failed on page load -conversion:", e);
    }

    // Send a message to the popup when the user scrolls the page.
    window.addEventListener("scroll", debounce(() => {
        const browserObj = (typeof chrome !== "undefined" ? chrome : globalThis.browser);
        if (browserObj && browserObj.runtime && browserObj.runtime.id) {
            browserObj.runtime.sendMessage({ action: "pageScrolled" }).catch((err) => {
                // Ignore error when popup/background is not listening.
            });
        }
    }, 200));

    log("Loaded");
})();
