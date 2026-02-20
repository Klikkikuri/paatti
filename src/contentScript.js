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
    // Import modules.
    const browser = (chrome || browser);
    const { model: model, modelEvents: modelEvents } = await import(browser.runtime.getURL("src/model.js"));
    const { controller } = await import(browser.runtime.getURL("src/controller.js"));
    const { getLogger } = await import(browser.runtime.getURL("src/utils.js"));

    const { rahtiStorage } = await import(browser.runtime.getURL("src/rahti.js"));

    const { highlightElemConverted, highlightElemOriginal } = await import(browser.runtime.getURL("src/conversionUtils.js"));

    const log = getLogger("content_script");

    // Remove the event from content script, as Chrome cries when it tries to
    // access browser.tabs sending conversion message.
    await model.events.removeEventListener(modelEvents.enabledChange, controller.dispatchConversion);

    try {
        await initSuola(browser.runtime.getURL("suola/build/js.wasm"));
    } catch (e) {
        log("Paatti sailing in fresh water :/ ", e);
        // TODO: Try a couple times and eventually set some error state for GUI.
        return;
    }

    const rahti = await rahtiStorage;

    if (!rahti) {
        log("No Rahti data found, aborting conversion.", rahti);
        return;
    }

    const newsSite = window.location.hostname;

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
        // Define the two branches that the conversion procedure can take: 1)
        // Convert clickbaits OR 2) Restore clickbaits (i.e., restore the
        // originals).

        const convertClickbait = async (titleElem, link, { rahtiEntry }) => {
            const originalTitle = titleElem.textContent;
            const convertedTitle = rahtiEntry.title;

            if (titleElem.dataset.klikkikuriConvertedTitle === convertedTitle) {
                // No action needed, already converted before.
                return;
            }

            titleElem.dataset.klikkikuriOriginalTitle = originalTitle;
            titleElem.dataset.klikkikuriConvertedTitle = convertedTitle;
            titleElem.dataset.klikkikuriClickbaitLevel = rahtiEntry.clickbaitiness;

            // Replace the title text.
            titleElem.textContent = `${convertedTitle}`;

            if (isPopupOpen || await model.read.isPersistentConvertedHighlight()) {
                await highlightElemConverted(titleElem);
            }

            log(`Converted title from '${originalTitle}' to '${convertedTitle}' for link:`, link);
        };

        const restoreClickbait = async (titleElem, link) => {
            const convertedTitle = titleElem.dataset.klikkikuriConvertedTitle;
            const originalTitle = titleElem.dataset.klikkikuriOriginalTitle;

            if (!originalTitle) {
                // No action needed, never converted before.
                return;
            }

            titleElem.textContent = originalTitle
            await highlightElemOriginal(titleElem);

            // This needs to be removed so that the next
            // conversion will not be skipped.
            delete titleElem.dataset.klikkikuriConvertedTitle;

            log(`Restored title from '${convertedTitle}' to '${originalTitle}' for link:`, link);
        };

        const processingPromises = await processTitleElems(async (rule, container, link) => {
            // TODO: Might not work on javascript generated links (onclick etc.)
            const href = link.getAttribute('href');
            if (!href) {
                log("Skipping link without href:", link);
            }
            const urlHash = await hrefSign(href);
            // Store for debugging
            link.dataset.klikkikuriUrlHash = urlHash;

            const rahtiEntry = await rahti.get(urlHash)
            if (rahtiEntry) {
                const titleElem = rule.title ? container.querySelector(rule.title) : link;
                if (titleElem) {
                    if (await model.read.isEnabled(newsSite)) {
                        await convertClickbait(titleElem, link, { rahtiEntry });
                        // Return the amount of converted titles
                        // for gathering stats.
                        return 1;
                    } else {
                        log(`Conversion not enabled for site '${newsSite}'`)
                        await restoreClickbait(titleElem, link);
                    }
                } else {
                    log(`No title element found for rule title selector '${rule.title}' in link:`, link);
                }
            } else {
                log(`No Rahti entry found for hash '${urlHash}' of link:`, link);
            }
            // Return the amount of converted titles
            // for gathering stats.
            return 0;
        });
        
        // TODO: Handle any errors found in promises.
        const convertedTitlesCount = (await Promise.allSettled(processingPromises))
            .reduce((acc, x) => acc + x.value, 0);

        await controller.updateStatistics({
            hostname: newsSite,
            restoreTitleData: { "convertedTitlesCount": convertedTitlesCount },
        });

        log("Finished conversion procedure.");

    };

    const observer = new MutationObserver(async (mutations) => {
        // Use original title as the flag, as a converted title would be
        // removed when restoring page to show original titles.
        const isInternalChange = mutations.every(mutation =>
            mutation.target.dataset.klikkikuriOriginalTitle ||
            mutation.target.parentElement?.dataset.klikkikuriOriginalTitle
        );
        if (isInternalChange) {
            return;
        }

        log(`Observed ${mutations.length} DOM mutations, triggering conversion process.`);
        try {
            await processSite();
        } catch (e) {
            log("Error during conversion after DOM mutation:", e);
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false // Ignore attribute changes to prevent loop from setAttribute
    });

    const convertClickbaits = async (apiUrl, links) => {
    };

    browser.runtime.onMessage.addListener(async (message) => {
        log(`Received message '${JSON.stringify(message)}' on '${newsSite}'`);

        switch (message.command) {
            case "convertClickbaits":
                await processSite();
                break;
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

    // Keep polling the popup in order to highlight converted titles
    // during and only during the time when the popup window is open.
    let isPopupOpen = false;
    const popupPoller = async () => {
        try {
            const response = await browser.runtime.sendMessage({ message: "isPopupOpen" });
            isPopupOpen = response.isOpen;
        } catch (e) {
            // (Assume) popup failed to response because it is closed
            isPopupOpen = false;
        }

        await Promise.allSettled(await processTitleElems(async (rule, container, link) => {
            const titleElem = rule.title ? container.querySelector(rule.title) : link;
            if (titleElem && titleElem.dataset.klikkikuriConvertedTitle === titleElem.textContent) {
                if (isPopupOpen || await model.read.isPersistentConvertedHighlight()) {
                    await highlightElemConverted(titleElem);
                } else {
                    await highlightElemOriginal(titleElem);
                }
            }
        }));

        setTimeout(popupPoller, 500);
    };
    // Start the polling
    setTimeout(popupPoller, 500);

    log("Loaded");
})();
