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

const log = getLogger("content_script");

const ERROR_VARIANTS = {
    noElementMatchesForQuerySelector: 1,
    noTitleMatchesForHash: 2,
};

const canonicallyHashizeElem = async (titleData, querySelectors, link) => {
    const titleElem = querySelectors
        .map((x) => link.querySelector(x))
        .find((x) => x != null);

    if (!titleElem) {
        throw {
            variant: ERROR_VARIANTS.noElementMatchesForQuerySelector,
            elem: link,
        };
    } else {
        let articleUrl = await extractArticleUrl(link);
        const linkHash = await hashUrl(articleUrl);

        log(linkHash);
        // Get the non-clickbait title.
        const canonicalHash = (titleData[linkHash]?.title != undefined)
            ? linkHash
            : titleData[linkHash]?.canonical;

        if (!canonicalHash) {
            throw {
                variant: ERROR_VARIANTS.noTitleMatchesForHash,
                elem: link,
                href: link.href,
                hash: linkHash,
            };
        } else {
            return {
                titleElem: titleElem,
                canonicalHash: canonicalHash,
            };
        }
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
            const err = x.reason;
            switch (err.variant) {
                case ERROR_VARIANTS.noElementMatchesForQuerySelector:
                    await noElementMatchesForQuerySelector(err.elem);
                    break;
                case ERROR_VARIANTS.noTitleMatchesForHash:
                    await noTitleMatchesForHash(err.elem);
                    break;
                default:
                    err = {
                        variant: "UnknownError",
                        data: err,
                    };
                    break
            }
            errors.push(err);
        }
    }
    log(`There were ${errors.length} links not processed.`);
    log(errors);

    return elems;
};

const replaceClickbaits = async (links, titleData, linkTitleQuerySelectors) => {
    for (const { titleElem, canonicalHash } of await getReplaceableTitleElements(links, titleData, linkTitleQuerySelectors)) {
        // Store the original title in memory for converting back.
        titleData[canonicalHash].restoreTitle = titleElem.textContent;

        titleElem.textContent = titleData[canonicalHash].title;
        await highlightElemConverted(titleElem);
    }

    return titleData;
};

const restoreClickbaits = async (links, titleData, linkTitleQuerySelectors) => {
    log("Restoring using data:", titleData);
    for (const { titleElem, canonicalHash } of await getReplaceableTitleElements(links, titleData, linkTitleQuerySelectors)) {
        titleElem.textContent = titleData[canonicalHash].restoreTitle;
        await highlightElemOriginal(titleElem);
    }

    return titleData;
};


// Main.
(async () => {
    // Reset the site disabled kerran -flag on refresh.    
    const currentTabHostname = window.location.hostname;
    await model.resetKerran(currentTabHostname);

    try {
        await initSuola(browser.runtime.getURL("suola/build/js.wasm"));
    } catch (e) {
        log("Paatti sailing in fresh water :/ ", e);
        // TODO: Try a couple times and eventually set some error state for GUI.
        return;
    }

    let tabRestoreTitleData = null;

    browser.runtime.onMessage.addListener(async (message) => {
        const newsSite = window.location.hostname;

        log(`Received message while browsing '${newsSite}': `, message);


        switch (message.command) {
            case "convertClickbaits":
                // Always either toggle the converted headlines on or off based
                // on enabled-status.

                const links = Array.from(document.querySelectorAll("a"));

                const linkTitleQuerySelectors = await model.getLinkTitleQuerySelectors(newsSite);

                if (await model.isConversionEnabled(newsSite)) {
                    log(`Casting our nets on ${newsSite} `);

                    const apiUrl = await getApiDataUrl();
                    let apiResponse;
                    try {
                        apiResponse = await fetch(apiUrl);
                    } catch (e) {
                        log(`Failed to fetch data from the API: ${e}`);
                        return;
                    }
                    const titleData = await apiResponse.json();

                    tabRestoreTitleData = await replaceClickbaits(links, titleData, linkTitleQuerySelectors);
                } else if (tabRestoreTitleData != null) {
                    log(`Restoring original state of ${newsSite} `);
                    // If the conversion has not run yet, there's nothing to restore.
                    tabRestoreTitleData = await restoreClickbaits(links, tabRestoreTitleData, linkTitleQuerySelectors);
                }

                await model.updateStatistics({
                    hostname: newsSite,
                    restoreTitleData: tabRestoreTitleData,
                    links: links,
                });

                break;
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    log("Loaded");
})();
