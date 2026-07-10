"use strict";

/*
 * README:
 *
 * This file/module depends on the following functions in its global scope:
 * - `hashUrl(url: string) -> string | falsy`
 *   - Function should normalize and return a sha256 hash of the input URL or a
 *   falsy value in case of an error.
 * - `initSuola(url: string) -> void`
 *   - Function should make the hashUrl-function available based on the
 *   provided URL/path of the WebAssembly module (browser extension accesses
 *   the .wasm file differently compared to normal browser scripts/files).
 */

// Use this to access this source file in the browser debugger.
//debugger;

const hrefSign = async (url) => {
    const urlObj = new URL(url, window.location.href);
    return await hashUrl(urlObj.href);
}

// Main.
(async () => {
    ////////////////////////////////////////////////////////////////////////////
    // Import modules.
    const browser = (chrome || browser);
    const { model: model, modelEvents: modelEvents, klikkikuriStatus: klikkikuriStatus } = await import(browser.runtime.getURL("src/model.js"));
    const { controller } = await import(browser.runtime.getURL("src/controller.js"));
    const { getLogger, debounce } = await import(browser.runtime.getURL("src/utils.js"));

    const { rahtiStorage } = await import(browser.runtime.getURL("src/rahti.js"));

    const log = getLogger("content_script");

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

    try {
        await initSuola(browser.runtime.getURL("suola/build/js.wasm"));
    } catch (e) {
        log("Paatti sailing in fresh water :/ ", e);
        // TODO: Try a couple times and eventually set some error state for GUI.
        return;
    }

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
                const links = container.querySelectorAll(rule.link);
                for (const link of links) {
                    processingPromises.push(f(rule, container, link));
                }
            }
        }
        return processingPromises;
    };

    const processSite = async () => {
        const startTime = performance.now();

        // Define the two branches that the conversion procedure can take: 1)
        // Convert clickbaits OR 2) Restore clickbaits (i.e., restore the
        // originals).

        const processingPromises = await processTitleElems(async (rule, container, link) => {
            let what = klikkikuriStatus.SKIPPED;
            let why = "";
            let how = "";

            try {
                // TODO: Might not work on javascript generated links (onclick etc.)
                const href = link.getAttribute('href');
                if (!href) {
                    why = "Link has no href attribute";
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    container.dataset.klikkikuriReason = why;
                    return { what, why, how };
                }

                const urlSign = await hrefSign(href);
                container.dataset.klikkikuriUrlSign = urlSign;

                const rahtiEntry = await rahti.get(urlSign);
                const titleElem = rule.title ? container.querySelector(rule.title) : link;

                if (!rahtiEntry) {
                    why = `No Rahti entry found for hash '${urlSign}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    container.dataset.klikkikuriReason = why;
                    return { what, why, how };
                }

                titleElem.dataset.klikkikuriClickbaitLevel = rahtiEntry.clickbaitiness;

                if (!titleElem) {
                    why = `No title element found for selector '${rule.title}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    container.dataset.klikkikuriReason = why;
                    return { what, why, how };
                }

                if (!titleElem.dataset.klikkikuriOriginalTitle) {
                    titleElem.dataset.klikkikuriOriginalTitle = titleElem.textContent;
                }
                titleElem.dataset.klikkikuriConvertedTitle = rahtiEntry.title;

                const isSiteEnabled = await model.read.isEnabled(newsSite);
                const shouldConvert = await model.read.shouldConvert(rahtiEntry.clickbaitiness);

                if (isSiteEnabled && shouldConvert) {
                    what = "converted";
                    why = rahtiEntry.clickbaitiness;
                    how = (titleElem.textContent = rahtiEntry.title);

                    container.dataset.klikkikuriStatus = klikkikuriStatus.CONVERTED;
                    container.dataset.klikkikuriReason = `Converted (Clickbaitiness level: ${why})`;
                } else {
                    what = "original";
                    why = !isSiteEnabled 
                        ? `Conversion not enabled for site '${newsSite}'` 
                        : `Clickbaitiness level for '${rahtiEntry.clickbaitiness}' is below threshold`;
                    how = (titleElem.textContent = titleElem.dataset.klikkikuriOriginalTitle);

                    container.dataset.klikkikuriStatus = klikkikuriStatus.ORIGINAL;
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
            return { what, why, how };
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
                    .map((x) => x.what === "converted" ? x.why : null)
                    .filter((x) => x !== null)
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
            const siteRules = await model.read.getSiteRules(newsSite);
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
        // Use original title as the flag, as a converted title would be
        // removed when restoring page to show original titles.
        const isInternalChange = mutations.every(mutation =>
            mutation.target.dataset.klikkikuriOriginalTitle ||
            mutation.target.parentElement?.dataset.klikkikuriOriginalTitle
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
    browser.runtime.onMessage.addListener(async (message) => {
        log(`Received message '${JSON.stringify(message)}' on '${newsSite}'`);

        switch (message.command) {
            case "convertClickbaits":
                await processSite();
                break;
            case "devmode_generateLinkSignatures":
                const links = Array.from(document.querySelectorAll("a"));
                const signaturePromises = links.map((x) => hrefSign(x.href));
                return Promise.all(signaturePromises);
            case "getConversions": {
                const onlyVisible = message.onlyVisible;
                const containers = Array.from(document.querySelectorAll("[data-klikkikuri-status='converted']"));
                const results = [];
                for (const container of containers) {
                    if (onlyVisible && !isElementVisibleInViewport(container)) {
                        continue;
                    }
                    const titleElem = container.querySelector("[data-klikkikuri-original-title]") || container;
                    results.push({
                        urlSign: container.dataset.klikkikuriUrlSign || "",
                        originalTitle: titleElem.dataset.klikkikuriOriginalTitle || titleElem.textContent,
                        convertedTitle: titleElem.dataset.klikkikuriConvertedTitle || "",
                        clickbaitLevel: titleElem.dataset.klikkikuriClickbaitLevel || ""
                    });
                }

                if (rahti) {
                    try {
                        const pageUrl = window.location.href;
                        const pageSign = await hrefSign(pageUrl);
                        const pageRahtiEntry = await rahti.get(pageSign);
                        if (pageRahtiEntry) {
                            const pageOriginalTitle = document.querySelector("h1")?.textContent?.trim() || document.title;
                            results.push({
                                urlSign: pageSign,
                                originalTitle: pageOriginalTitle,
                                convertedTitle: pageRahtiEntry.title,
                                clickbaitLevel: pageRahtiEntry.clickbaitiness,
                                isMainPage: true
                            });
                        }
                    } catch (err) {
                        log("Error checking current page URL signature:", err);
                    }
                }

                return results;
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

    log("Loaded");
})();
