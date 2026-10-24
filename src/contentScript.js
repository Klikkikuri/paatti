"use strict";



// Use this to access this source file in the browser debugger.
//debugger;

const LABEL_PAYWALLED = "com.github.klikkikuri/paywalled=true";

let hrefSigns;

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

    const { applyModifiers, LABEL_CONVERTED } = await import(browser.runtime.getURL("src/modifiers.js"));
    const { buildPageSnapshot, createSessionTracker } = await import(browser.runtime.getURL("src/stats.js"));

    // Badges are built here, in the isolated world, and never registered in the page.
    //
    // Registering them meant putting <script src="moz-extension://<uuid>/..."> in the page's head, and
    // Firefox generates that UUID per install -- so every supported page could read a stable identifier
    // for this user with one querySelector, in an extension whose point is not tracking people. Nothing
    // of the extension's own URL enters the page now; these imports stay in the isolated world.
    const { buildBadge, isUserActivation } = await import(browser.runtime.getURL("src/components/badge-base.js"));
    const badgeIcons = new Map(await Promise.all([
        "klikkikuri-ai-badge",
        "klikkikuri-video-badge",
        "klikkikuri-converted-badge"
    ].map(async (tagName) => [tagName, await import(browser.runtime.getURL(`src/components/${tagName}.js`))])));

    const log = getLogger("content_script");

    /** The converted title lives on the container's title element, or on the container itself. */
    const convertedTitleOf = (element) =>
        (element.querySelector("[data-klikkikuri-original-title]") || element).dataset.klikkikuriConvertedTitle;

    // Reports on a conversion, in the page, in a shadow root of its own. The popup cannot be opened from here.
    const feedbackDialog = createFeedbackDialog({
        browser,
        log,
        getDatabaseStatus: model.read.getDatabaseStatus,
        // Reached through the overlay declared below, which exists by the time anything can open the card.
        setHighlighted: (element, on) => highlightOverlay.setFeedback([element], on)
    });

    // Draws the debug outlines, the popup's hover highlight and the card's highlight, in a shadow root of its own.
    const highlightOverlay = createHighlightOverlay({
        canActivate: (element) => Boolean(convertedTitleOf(element)),
        onLabelActivate: (element, label) => feedbackDialog.open(element, label)
    });

    // The converted badge is a button that opens the same card as a status pill; its own keyboard handling
    // arrives here as a click too. Delegated rather than bound per badge: processSite rebuilds the badges on
    // every pass, and a page that recycles its DOM would otherwise leave listeners on detached nodes.
    // Capture, so the page cannot swallow the click first. Only a user's click or key opens the card; a
    // click the page dispatches goes on to the page as if the extension were not there.
    document.addEventListener("click", (event) => {
        const badge = event.target.closest?.("klikkikuri-converted-badge[action]");
        const container = badge?.closest("[data-klikkikuri-status]");
        if (!container || !isUserActivation(event)) return;

        // The badge sits inside the headline's link, as the pill sits over it: without both of these the
        // click would navigate, and the page's own listeners would see a click they cannot explain.
        event.preventDefault();
        event.stopPropagation();
        // The badge is handed over to be measured, never held: the card takes its offsets and lets it go,
        // because the next conversion pass replaces every badge on the page.
        feedbackDialog.open(container, badge);
    }, { capture: true });

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
    // No domain travels with it: the worker takes that from the sender, so a page cannot name the key
    // its favicon is written under.
    browser.runtime.sendMessage({
        action: "storeFavicon",
        url: extractFaviconUrl()
    }).catch((err) => {
        log("storeFavicon message failed (non-fatal):", err);
    });

    hrefSigns = async (url) => {
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

    const updateStatusHighlighting = async () => {
        try {
            const enabled = await model.read.getVisualHighlightEnabled();
            const visible = enabled || isPopupOpen;
            highlightOverlay.setStatusVisible(visible);
        } catch (e) {
            log("Failed to update status highlighting", e);
        }
    };

    await updateStatusHighlighting();

    // Listen for storage changes to toggle the highlighting dynamically
    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.visualHighlightEnabled) {
            updateStatusHighlighting();
        }
    });

    ////////////////////////////////////////////////////////////////////////////
    // Global state.

    const newsSite = window.location.hostname;
    const matchingDomain = await model.read.getMatchingSiteDomain(newsSite);
    const sessionTracker = createSessionTracker();

    let lastPageSnapshot = null;
    let activePort = null;

    ////////////////////////////////////////////////////////////////////////////
    // Initialization.

    // Listen for popup direct connection to manage highlighting and live stats push
    browser.runtime.onConnect.addListener((port) => {
        if (port.name === "paatti-popup-direct") {
            log("Popup connection established.");
            // The popup carries the same card in its feedback view, so the in-page one stands down rather
            // than leaving the user two of them, one of which they cannot see behind the popup.
            feedbackDialog.close();
            activePort = port;
            isPopupOpen = true;
            updateStatusHighlighting();

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
                log("Popup connection closed.");
                activePort = null;
                isPopupOpen = false;
                updateStatusHighlighting();

                // A popup that closes mid-hover never sends its mouseleave, so drop what it raised.
                highlightOverlay.clearHover();
            });
        }
    });

    ////////////////////////////////////////////////////////////////////////////
    // Processing subroutines.

    /**
     * Every link that the site rules find: each matched container, and each link in it with its title element, which
     * is null when the rule's title selector finds nothing.
     */
    const scanSiteRules = (siteRules) => {
        const containers = new Set();
        const links = [];
        for (const rule of siteRules) {
            for (const container of document.querySelectorAll(rule.container)) {
                containers.add(container);
                const ruleLinks = (!rule.link || rule.link === "self" || rule.link === ":scope")
                    ? [container]
                    : container.querySelectorAll(rule.link);
                for (const link of ruleLinks) {
                    const titleElem = (rule.title === "self" || rule.title === ":scope")
                        ? container
                        : (rule.title ? container.querySelector(rule.title) : link);
                    links.push({ container, link, rule, titleElem });
                }
            }
        }
        return { containers, links };
    };

    /** `href` resolved against the page, or null for an address that does not parse. */
    const absoluteHref = (href) => {
        try {
            return new URL(href, window.location.href).href;
        } catch {
            return null;
        }
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
        const { containers: matchedContainers, links } = scanSiteRules(siteRules);
        const linksToProcess = [];
        for (const { container, link, rule, titleElem } of links) {
            const href = titleElem && link.getAttribute('href');
            if (!href) {
                container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                continue;
            }
            const absolute = absoluteHref(href);
            if (absolute) linksToProcess.push({ container, link, rule, href: absolute, titleElem });
        }

        // Batch generate signatures from background service worker
        const uniqueUrls = Array.from(new Set(linksToProcess.map(x => x.href)));
        let urlSigns = {};
        if (uniqueUrls.length > 0) {
            try {
                const response = await browser.runtime.sendMessage({ action: "hashUrls", urls: uniqueUrls });
                if (response && response.success) {
                    urlSigns = response.hashes;
                } else {
                    log("Batch hashing failed:", response?.error);
                }
            } catch (err) {
                log("Failed to communicate with background for hashing:", err);
            }
        }

        // Process each element using pre-computed hashes. Scoped by the link's own host, not the page's: see
        // signUrls() in model.js.
        const rahtiEntries = await model.read.getRahtiEntries(urlSigns);
        const processingPromises = linksToProcess.map(async ({ container, link, rule, href, titleElem }) => {
            let what = klikkikuriStatus.SKIPPED;
            let why = "";
            let how = "";
            let clickbaitiness = null;
            let urlSign = null;

            try {
                if (!urlSigns[href]) {
                    why = `Failed to generate signature for URL '${href}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
                    return { what, why, how, clickbaitiness, urlSign: null };
                }
                urlSign = urlSigns[href].officialSign;
                container.dataset.klikkikuriUrlSign = urlSign || "";

                const rahtiEntry = rahtiEntries[href];
                if (!rahtiEntry) {
                    why = `No Rahti entry found for hash '${urlSign}'`;
                    container.dataset.klikkikuriStatus = klikkikuriStatus.SKIPPED;
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
                }

                // Apply registered title modifiers (e.g. AI marking). The dataset says what a link
                // is; only this pass knows whether the headline was swapped, so the converted
                // marker's label is added to a copy -- the entry itself is the shared cache's.
                const modifierEntry = what === "converted"
                    ? { ...rahtiEntry, labels: [...(rahtiEntry.labels || []), LABEL_CONVERTED] }
                    : rahtiEntry;
                const modifierResult = await applyModifiers(titleText, modifierEntry);
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
                            const icon = badgeIcons.get(b.tagName);
                            if (!icon) continue;

                            // `action` turns the badge into a button, named by whichever modifier claimed one.
                            children.push(buildBadge({
                                tagName: b.tagName,
                                svgMarkup: icon.svgMarkup,
                                defaultLabel: icon.defaultLabel,
                                label: b.badgeText,
                                tooltip: b.tooltip,
                                action: b.action
                            }));
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
            case "devmode_capturePage": {
                // devmode (development-only; see docs/PRIVACY_POLICY_DEVELOPMENT.md): the site rules, and the links
                // that they find with the headline that the page itself shows. The server signs them; nothing here
                // is sent anywhere. The command reaches the content script only through src/options/dev-capture.js.
                (async () => {
                    const rules = await model.read.getSiteRules(newsSite) || [];
                    const { links } = scanSiteRules(rules);
                    const captured = [];
                    for (const { link, titleElem } of links) {
                        const raw = link.getAttribute("href");
                        const href = titleElem && raw && absoluteHref(raw);
                        if (!href || !/^https?:/.test(href)) continue;
                        const title = (titleElem.dataset.klikkikuriOriginalTitle ?? titleElem.textContent).trim();
                        if (!title) continue;
                        captured.push({ href, title });
                    }
                    return { pageUrl: window.location.href, rules, links: captured };
                })()
                    .then((result) => sendResponse(result))
                    .catch((err) => {
                        log("Error capturing the page:", err);
                        sendResponse(null);
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

                    try {
                        const pageUrl = window.location.href;
                        const pageSigns = await hrefSigns(pageUrl);
                        if (pageSigns) {
                            const pageRahtiEntry = (await model.read.getRahtiEntries({ [pageUrl]: pageSigns }))[pageUrl];
                            if (pageRahtiEntry) {
                                const pageOriginalTitle = document.querySelector("h1")?.textContent?.trim() || document.title;
                                const h1 = document.querySelector("h1");
                                const highlightId = `kk-hl-main`;
                                if (h1) {
                                    h1.dataset.klikkikuriHighlightId = highlightId;
                                }
                                results.unshift({
                                    highlightId,
                                    urlSign: pageSigns.officialSign,
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
                highlightOverlay.setHover(document.querySelectorAll(`[data-klikkikuri-highlight-id="${message.highlightId}"]`), true);
                break;
            }
            case "unhighlightElement": {
                highlightOverlay.setHover(document.querySelectorAll(`[data-klikkikuri-highlight-id="${message.highlightId}"]`), false);
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
