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

let convertTitles;

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

    // Listen for popup direct connection to manage visibility styling
    browser.runtime.onConnect.addListener((port) => {
        if (port.name === "paatti-popup-direct") {
            log("Popup connection established, adding visible class.");
            document.body.classList.add("paatti-popup-visible");

            port.onDisconnect.addListener(() => {
                log("Popup connection closed, removing visible class.");
                document.body.classList.remove("paatti-popup-visible");
            });
        }
    });

    const rahti = await rahtiStorage;

    if (!rahti) {
        log("No Rahti data found, aborting conversion.", rahti);
        return;
    }

    const newsSite = window.location.hostname;

    convertTitles = async (doRestore) => {
        const siteRules = await model.read.getSiteRules(newsSite);
        if (!siteRules) {
            log(`No site rules found for '${newsSite}', aborting conversion.`);
        }

        for (const rule of siteRules) {
            const containers = document.querySelectorAll(rule.container);

            containers.forEach((container) => {
                const links = container.querySelectorAll(rule.link);

                links.forEach(async link => {
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
                            if (doRestore) {
                                const convertedTitle = titleElem.dataset.klikkikuriConvertedTitle;
                                const originalTitle = titleElem.dataset.klikkikuriOriginalTitle;

                                titleElem.textContent = originalTitle
                                await highlightElemOriginal(titleElem);

                                // This needs to be removed so that the next
                                // conversion will not be skipped.
                                delete titleElem.dataset.klikkikuriConvertedTitle;

                                log(`Restored title from '${convertedTitle}' to '${originalTitle}' for link:`, link);
                            } else {
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
                                highlightElemConverted(titleElem);

                                log(`Converted title from '${originalTitle}' to '${convertedTitle}' for link:`, link);
                            }
                        } else {
                            log(`No title element found for rule title selector '${rule.title}' in link:`, link);
                        }
                    } else {
                        log(`No Rahti entry found for hash '${urlHash}' of link:`, link);
                    }

                });
            });
        }
    };

    const observer = new MutationObserver((mutations) => {
        // Use original title as the flag, as for example converted title would
        // be removed when restoring page to show original titles.
        const isInternalChange = mutations.every(mutation =>
            mutation.target.dataset.klikkikuriOriginalTitle ||
            mutation.target.parentElement?.dataset.klikkikuriOriginalTitle
        );
        if (isInternalChange) {
            return;
        }

        log(`Observed ${mutations.length} DOM mutations, triggering conversion process.`);
        convertTitles(false).catch((e) => {
            log("Error during conversion after DOM mutation:", e);
        });
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false // Ignore attribute changes to prevent loop from setAttribute
    });

    const convertClickbaits = async (apiUrl, links) => {
        const linkTitleQuerySelectors = await model.read.getLinkTitleQuerySelectors(newsSite);

        // Always either toggle the converted headlines on or off based
        // on enabled-status.

        log("Basing conversion on source:", apiUrl);
        let apiResponse;
        try {
            apiResponse = await fetch(apiUrl);
        } catch (e) {
            log(`Failed to fetch data from the API: ${e}`);
            return;
        }
        const titleData = await apiResponse.json();

        let convertedTitlesCount;
        if (await model.read.isEnabled(newsSite)) {
            log(`Starting conversion on '${newsSite}'`);
            convertedTitlesCount = await convertTitles(false);
        } else {
            log(`Restoring original state of ${newsSite} `);
            await convertTitles(true);
            convertedTitlesCount = 0;
        }

        await controller.updateStatistics({
            hostname: newsSite,
            restoreTitleData: { "convertedTitlesCount": convertedTitlesCount },
            links: links,
        });

        log("Finished conversion procedure.");

    };

    browser.runtime.onMessage.addListener(async (message) => {
        log(`Received message '${JSON.stringify(message)}' on '${newsSite}'`);

        switch (message.command) {
            case "convertClickbaits":
                for (const titleDataUrl of await model.read.getTitleDataUrls()) {
                    await convertClickbaits(titleDataUrl, Array.from(document.querySelectorAll("a")));
                }
                break;
            case "devmode_dumpLinkHash":
                return Array.from(document.querySelectorAll("a"))
                    .map((x) => { log(x.href, "=>", hrefSign(x.href)); return hrefSign(x.href); });
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });



    // Run the conversion on reload.
    await convertTitles(false);

    log("Loaded");
})();
