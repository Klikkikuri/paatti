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

// WORKAROUND: These variables will be used in "importing" from other JS files in main().
let log,
    extractArticleUrl,
    noElementMatchesForQuerySelector,
    noTitleMatchesForHash,
    highlightElemConverted,
    highlightElemOriginal;

const ERROR_VARIANTS = {
    UnknownError: "Unknown error",
    noElementMatchesForQuerySelector: "Empty query result for title elements under selected parent",
    noTitleMatchesForHash: "Found no conversion for given title in database",
};

const hrefSign = async (url) => {
    const urlObj = new URL(url, window.location.href);
    log("Computing hash for URL:", urlObj.href);

    return await hashUrl(urlObj.href);
}

const canonicallyHashizeElem = async (titleData, querySelectors, link) => {
    const titleElem = querySelectors
        .map((x) => {
            if (x === "") {
                // Empty selector means the a-tag is expected to contain the
                // title text itself.
                return link;
            } else {
                return link.querySelector(x);
            }
        })
        .find((x) => x != null);

    if (!titleElem) {
        throw {
            variant: ERROR_VARIANTS.noElementMatchesForQuerySelector,
            elem: link,
        };
    }

    const articleUrl = await extractArticleUrl(link);
    const linkHash = await hashUrl(articleUrl);


    let match = null;
    for (const entry of titleData.entries) {
        if (entry.urls.filter((x) => x.sign === linkHash).length > 0) {
            match = entry;
            break;
        }
    }

    if (!match) {
        throw {
            variant: ERROR_VARIANTS.noTitleMatchesForHash,
            elem: link,
            href: link.href,
            hash: linkHash,
        };
    } else {
        return {
            titleElem: titleElem,
            entry: match,
        };
    }
};

/**
 * Filter out the links not processed in backend.
 */
const getReplaceableTitleElements = async (links, titleData, linkTitleQuerySelectors) => {
    const elemPromises = links.map((x) => canonicallyHashizeElem(
        titleData,
        linkTitleQuerySelectors ?? [],
        x));

    const elems = [];
    const errors = [];
    for (const x of await Promise.allSettled(elemPromises)) {
        if (x.status === "fulfilled") {
            elems.push(x.value);
        } else {
            let err = x.reason;
            switch (err.variant) {
                case ERROR_VARIANTS.noElementMatchesForQuerySelector:
                    await noElementMatchesForQuerySelector(err.elem);
                    break;
                case ERROR_VARIANTS.noTitleMatchesForHash:
                    await noTitleMatchesForHash(err.elem);
                    break;
                default:
                    err = {
                        variant: ERROR_VARIANTS.UnknownError,
                        data: err,
                    };
                    break
            }
            errors.push(err);
        }
    }
    const errorStats = {};
    for (const variant of Object.values(ERROR_VARIANTS)) {
        errorStats[variant] = errors.filter((x) => x.variant === variant);
    }
    log(`There were ${errors.length} links not processed:`, errorStats);

    return elems;
};

const harvestTitleElements = async (links, titleData, linkTitleQuerySelectors) => {
    const xs = [];
    for (const { titleElem, entry } of await getReplaceableTitleElements(links, titleData, linkTitleQuerySelectors)) {
        if (!titleElem.getAttribute("__klikkikuri_original_title")) {
            // Store the original title in memory for when wanting to convert
            // back later if not already.
            titleElem.setAttribute("__klikkikuri_original_title", titleElem.textContent);
        }
        xs.push({
            titleElem,
            originalTitle: titleElem.getAttribute("__klikkikuri_original_title"),
            convertedTitle: entry.title,
        });
    }
    return xs;
};

const processClickbaits = async (links, titleData, linkTitleQuerySelectors, f) => {
    const SUPPORTED_SCHEMA_VERSION = "0.1.0";
    if (titleData.schema_version != SUPPORTED_SCHEMA_VERSION) {
        // TODO: What now? Link user to update page?
        throw `The title data format is not compatible: version is ${titleData.schema_version} when expected ${SUPPORTED_SCHEMA_VERSION}. Update Paatti in order to fix.`;
    }

    const thisPageTitleData = await harvestTitleElements(links, titleData, linkTitleQuerySelectors);
    for (const { titleElem, originalTitle, convertedTitle } of thisPageTitleData) {
        await f(titleElem, { originalTitle, convertedTitle });
    }

    return thisPageTitleData;
};

const replaceClickbaits = async (links, titleData, linkTitleQuerySelectors) => {
    let count = 0;
    await processClickbaits(links, titleData, linkTitleQuerySelectors,
        async (titleElem, { convertedTitle }) => {
            titleElem.textContent = convertedTitle;
            await highlightElemConverted(titleElem);
            count += 1;
        }
    );
    return count;
};

const restoreClickbaits = async (links, titleData, linkTitleQuerySelectors) => {
    await processClickbaits(links, titleData, linkTitleQuerySelectors,
        async (titleElem, { originalTitle }) => {
            titleElem.textContent = originalTitle;
            await highlightElemOriginal(titleElem);
        }
    );
};


// Main.
(async () => {
    // Import modules.
    const browser = (chrome || browser);
    const { model, modelEvents } = await import(browser.runtime.getURL("src/model.js"));
    const { controller } = await import(browser.runtime.getURL("src/controller.js"));
    const { getLogger } = await import(browser.runtime.getURL("src/utils.js"));

    const { rahtiStorage } =  await import(browser.runtime.getURL("src/rahti.js"));


    const cu = await import(browser.runtime.getURL("src/conversionUtils.js"));
    extractArticleUrl = cu.extractArticleUrl;
    noElementMatchesForQuerySelector = cu.noElementMatchesForQuerySelector;
    noTitleMatchesForHash = cu.noTitleMatchesForHash;
    highlightElemConverted = cu.highlightElemConverted;
    highlightElemOriginal = cu.highlightElemOriginal;

    log = getLogger("content_script");

    // Remove the event from content script, as Chrome cries when it tries to
    // access browser.tabs sending conversion message.
    await model.events.removeEventListener(modelEvents.enabledChange, controller.dispatchConversion);

    // Reset the site disabled kerran -flag on refresh.    
    const currentTabHostname = window.location.hostname;
    await controller.resetKerran(currentTabHostname);

    try {
        await initSuola(browser.runtime.getURL("suola/build/js.wasm"));
    } catch (e) {
        log("Paatti sailing in fresh water :/ ", e);
        // TODO: Try a couple times and eventually set some error state for GUI.
        return;
    }

    const newsSite = window.location.hostname;

    const convertClickbaits = async (links) => {
        const linkTitleQuerySelectors = await model.read.getLinkTitleQuerySelectors(newsSite);

        // Always either toggle the converted headlines on or off based
        // on enabled-status.

        const apiUrl = await model.read.getTitleDataUrl();
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
            convertedTitlesCount = await replaceClickbaits(links, titleData, linkTitleQuerySelectors);
        } else {
            log(`Restoring original state of ${newsSite} `);
            await restoreClickbaits(links, titleData, linkTitleQuerySelectors);
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
                await convertClickbaits(Array.from(document.querySelectorAll("a")));
                break;
            case "devmode_dumpLinkHash":
                return Array.from(document.querySelectorAll("a"))
                    .map((x) => { log(x.href, "=>", hrefSign(x.href)); return hrefSign(x.href); });
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    const rahti = await rahtiStorage;

    if (!rahti) {
        log("No Rahti data found, aborting conversion.", rahti);
        return;
    }

    const convertTitles = async () => {

        // Run the conversion on reload.
        const siteRules = await model.read.getSiteRules(newsSite);
        if (!siteRules) {
            log(`No site rules found for '${newsSite}', aborting conversion.`);
        }

        for (const rule of siteRules) {
            const containers = document.querySelectorAll(rule.container);

            containers.forEach( (container) => {
                const links = container.querySelectorAll(rule.link);
                
                links.forEach(async link => {
                    // TODO: Might not work on javascript generated links (onclick etc.)
                    const href = link.getAttribute('href');
                    if (!href) {
                        log("Skipping link without href:", link);
                    }
                    const urlHash = await hrefSign(href);

                    const rahtiEntry = await rahti.get(urlHash)
                    if (rahtiEntry) {
                        const titleElem = rule.title ? container.querySelector(rule.title) : link;
                        if (titleElem) {
                            const originalTitle = titleElem.textContent;
                            const convertedTitle = rahtiEntry.title;

                            if (titleElem.getAttribute("__klikkikuri_original_title")) {
                                // No action needed, already converted before.
                            }
                            titleElem.setAttribute("__klikkikuri_original_title", originalTitle);

                            // Replace the title text.
                            titleElem.textContent = `${convertedTitle}`;
                            highlightElemConverted(titleElem);

                            log(`Converted title from '${originalTitle}' to '${convertedTitle}' for link:`, link);
                        } else {
                            log(`No title element found for rule title selector '${rule.title}' in link:`, link);
                        }
                    } else {
                        log(`No Rahti entry found for hash '${urlHash}' of link:`, link);
                    }

                });
            });
        }
    }

    const observer = new MutationObserver((mutations) => {
        const isInternalChange = mutations.every(mutation => 
            mutation.target.hasAttribute?.('__klikkikuri_original_title') || 
            mutation.target.parentElement?.hasAttribute?.('__klikkikuri_original_title')
        );
        if (isInternalChange) {
            return;
        }

        log(`Observed ${mutations.length} DOM mutations, triggering conversion process.`);
        convertTitles().catch((e) => {
            log("Error during conversion after DOM mutation:", e);
        });
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false // Ignore attribute changes to prevent loop from setAttribute
    });

    await convertTitles();

    log("Loaded");
})();
