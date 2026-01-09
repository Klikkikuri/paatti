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
                    .map((x) => { log(x.href, "=>", hashUrl(x.href)); return hashUrl(x.href); });
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    // Run the conversion on reload.
    await convertClickbaits(Array.from(document.querySelectorAll("a")));

    // Configure the observer for dynamically loaded contents.
    const mutationObserverConfig = { childList: true, subtree: true };

    // Callback function to execute when mutations are observed
    const callback = async (mutationList, observer) => {
        let addedNodes = [];
        for (const mutation of mutationList) {
            // TODO: Run conversion on the appeared title.
            if (mutation.type === "childList") {
                if (mutation.target instanceof HTMLAnchorElement) {
                    addedNodes.push(mutation.target);
                } else {
                    addedNodes = [...addedNodes, ...mutation.addedNodes];
                }
            } else {
                log(`Unnecessarily(?) observed DOM mutation of type ${mutation.type}`);
            }
        }

        for (const i in addedNodes) {
            if (addedNodes[i].nodeType == Node.TEXT_NODE) {
                addedNodes[i] = addedNodes[i].parentElement;
            }
            // Only pass link type DOM elements forward.
            addedNodes[i] = addedNodes[i].closest("a");

            // Only pass non-processed links forward.
            if (!addedNodes[i].getAttribute("__klikkikuri_processed_dynamic_link")) {
                addedNodes[i].setAttribute("__klikkikuri_processed_dynamic_link", "true");
            } else {
                // Remove any already mutated elements from being mutated again,
                // which would start an infinite event loop.
                addedNodes[i] = null;
            }
        }
        addedNodes = addedNodes.filter((x) => x);

        if (addedNodes.length > 0) {
            log(`Observed mutations added total of ${addedNodes.length} new nodes to search for news title elements`);
            await convertClickbaits(addedNodes);
        } else {
            log("No observed mutations selected for further processing.");
        }
    };

    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);

    // Add observers for dynamically loaded contents.
    const mutationProneQuerySelectors = await model.read.getMutationProneQuerySelectors(newsSite);
    if (mutationProneQuerySelectors) {
        for (const selector of mutationProneQuerySelectors) {
            for (const targetNode of document.querySelectorAll(selector)) {
                // Start observing the target node for configured mutations
                observer.observe(targetNode, mutationObserverConfig);
            }
        }
    }

    log("Loaded");
})();
