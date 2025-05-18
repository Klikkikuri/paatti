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


const getGlobalConfig = async () => {
    const config = await browser.storage.local.get();

    log("Global config:", config);

    return config;
};

const getSiteConfig = async (newsSite) => {
    const siteConfigs = await browser.storage.local.get("siteConfigs");
    const siteConfig = siteConfigs.siteConfigs[newsSite];

    log("Site config:", siteConfig);

    return siteConfig;
};

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
        let articleUrl;
        if (await isDevelopmentEnv()) {
            articleUrl = testUrls[
                Array.from(link.href)
                    .reduce((sum, charStr) => sum + charStr.charCodeAt(0), 0)
                % 6
            ];
        } else {
            articleUrl = link.href;
        }

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
const getReplaceableTitleElements = async (titleData, siteConfig) => {
    const elemPromises = [];
    for (const link of document.querySelectorAll("a")) {
        elemPromises.push(
            canonicallyHashizeElem(
                titleData,
                siteConfig.linkTitleQuerySelectors ?? [],
                link)
        );
    }

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

const replaceClickbaits = async (apiUrl, siteConfig) => {
    let apiResponse;
    try {
        apiResponse = await fetch(apiUrl);
    } catch (e) {
        log(`Failed to fetch data from the API: ${e}`);
        return;
    }
    const titleData = await apiResponse.json();

    for (const { titleElem, canonicalHash } of await getReplaceableTitleElements(titleData, siteConfig)) {
        // Store the original title in memory for converting back.
        titleData[canonicalHash].restoreTitle = titleElem.textContent;

        titleElem.textContent = titleData[canonicalHash].title;
        await highlightElemConverted(titleElem);
    }

    return titleData;
};

const restoreClickbaits = async (titleData, siteConfig) => {
    log("Restoring using data:", titleData);
    for (const { titleElem, canonicalHash } of await getReplaceableTitleElements(titleData, siteConfig)) {
        titleElem.textContent = titleData[canonicalHash].restoreTitle;
        await highlightElemOriginal(titleElem);
    }
};




// Main.
(async () => {
    try {
        await initSuola(browser.runtime.getURL("suola/build/suola.wasm"));
    } catch (e) {
        log("Paatti sailing in fresh water :/ ", e);
        // TODO: Try a couple times and eventually set some error state for GUI.
        return;
    }

    let tabRestoreTitleData = null;

    /**
     * Listen for messages from the background script.
     */
    browser.runtime.onMessage.addListener(async (message) => {
        const newsSite = window.location.hostname;

        log(`Received message while browsing '${newsSite}': `, message);

        switch (message.command) {
            case "convertClickbaits":
                // Always either toggle the converted headlines on or off based
                // on enabled-status.

                const globalConfig = await getGlobalConfig();
                if (!globalConfig["enabled"]) {
                    log("Conversion is globally disabled");
                }

                const siteConfig = await getSiteConfig(newsSite);
                if (!siteConfig) {
                    log(`'${newsSite}' is not supported.`);
                }

                const doReplaceNow = globalConfig["enabled"] && siteConfig["enabled"];
                if (doReplaceNow) {
                    log(`Casting our nets on ${newsSite} `);
                    const apiUrl = await getApiDataUrl();
                    tabRestoreTitleData = await replaceClickbaits(apiUrl, siteConfig);
                } else if (tabRestoreTitleData != null) {
                    log(`Restoring original state of ${newsSite} `);
                    // If the conversion has not run yet, there's nothing to restore.
                    tabRestoreTitleData = await restoreClickbaits(tabRestoreTitleData, siteConfig);
                }
                break;
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    log("Loaded");
})();
