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

/**
 * Filter out the links not processed in backend.
 */
const getReplaceableTitleElements = async (titleData, siteConfig) => {
    const failedLinks = [];
    const elems = [];
    for (const link of document.querySelectorAll("a")) {
        // TODO: There might be more than just one way on a site to query
        // the text elements of the links.
        const titleElem = siteConfig.linkTitleQuerySelector
            ? link.querySelector(siteConfig.linkTitleQuerySelector)
            : link;

        let articleUrl;
       if (await isDevelopmentEnv()) {
            articleUrl = testUrls[
                Array.from(link.href)
                    .reduce((sum, charStr) => sum + charStr.charCodeAt(0), 0)
                % 6
            ];
            // Highlight the element that was processed.
            link.style.backgroundColor = "cyan";
            link.style.borderStyle = "dashed";
            link.style.borderColor = "#0981D1";
            link.style.borderWidth = "5px";
        } else {
            articleUrl = link.href;
        }

        const linkHash = await hashUrl(articleUrl);

        log(linkHash);
        // Get the non-clickbait title.
        const canonicalHash = (titleData[linkHash]?.title != undefined)
            ? linkHash
            : titleData[linkHash]?.canonical;

        if (canonicalHash == undefined || titleElem == undefined) {
            failedLinks.push({
                "elem": link,
                "href": link.href,
                "hash": linkHash
            });
            continue;
        }

        elems.push({ titleElem: titleElem, canonicalHash: canonicalHash });
    }
    log(`There were ${failedLinks.length} links not processed.`);
    log(failedLinks);

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
    }

    return titleData;
};

const restoreClickbaits = async (titleData, siteConfig) => {
    log("Restoring using data:", titleData);
    for (const { titleElem, canonicalHash } of await getReplaceableTitleElements(titleData, siteConfig)) {
        titleElem.textContent = titleData[canonicalHash].restoreTitle;
    }
};




// Main.
(async () => {
    await initSuola(browser.runtime.getURL("suola/build/suola.wasm"));

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
