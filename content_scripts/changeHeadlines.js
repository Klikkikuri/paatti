"use strict";

const log = (...args) => {
    console.log("content_script:", ...args);
};

/* Configurations used per newssite */
/**
 * Copied from:
 * https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest#converting_a_digest_to_a_hex_string
 */
const hashUrl = async (url) => {
    const msgUint8 = new TextEncoder().encode(url); // encode as (utf-8) Uint8Array
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""); // convert bytes to hex string
    return hashHex;
};

const getGlobalConfig = async () => {
    const config = await browser.storage.local.get();

    log("Global config:", config);

    return config;
};

const getSiteConfig = async (newsSite) => {
    const siteConfigs = await browser.storage.local.get("siteConfigs");
    const siteConfig = siteConfigs["siteConfigs"][newsSite];

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

        const linkHash = await hashUrl(link.href);

        // TODO START
        // TODO: Use real hashes once there's a backend delivering real data.
        const PLACEHOLDERHASH = Number("0x" + linkHash) % 6;
        if (!titleData[linkHash]) {
            titleData[linkHash] = {
                title: (titleData[PLACEHOLDERHASH]?.title != undefined)
                    ? titleData[PLACEHOLDERHASH].title
                    : titleData[titleData[PLACEHOLDERHASH].canonical].title
            };
        }
        // TODO END

        // Get the non-clickbait title.
        const canonicalHash = (titleData[linkHash]?.title != undefined)
            ? linkHash
            : titleData[titleData[linkHash]]?.canonical;

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
    // TODO: log error to some backend.
    log(`There were ${failedLinks.length} links not processed.`);
    log(failedLinks);
 
    return elems;
};

const replaceClickbaits = async (apiUrl, siteConfig) => {
    const apiResponse = await fetch(apiUrl);
    const titleData = (await apiResponse.json()).hashesToTitles;
    log(titleData);

    for (const {titleElem, canonicalHash} of await getReplaceableTitleElements(titleData, siteConfig)) {
        // Store the original title in memory for converting back.
        titleData[canonicalHash].restoreTitle = titleElem.textContent;

        titleElem.textContent = titleData[canonicalHash].title;
    }

    return titleData;
};

const restoreClickbaits = async (titleData, siteConfig) => {
    log("Restoring using data:", titleData);
    for (const {titleElem, canonicalHash} of await getReplaceableTitleElements(titleData, siteConfig)) {
        titleElem.textContent = titleData[canonicalHash].restoreTitle;
    }
};

// Main.
(async () => {
    // TODO: Read this from a config for dev and prod environments somehow?
    const API_URL = "http://localhost:8000/headlines/testData.json";

    let tabRestoreTitleData = null;

    /**
     * Listen for messages from the background script.
     */
    browser.runtime.onMessage.addListener(async (message) => {
        const newsSite = window.location.hostname;

        log(`Received message while browsing '${newsSite}':`, message);

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
                    log(`Casting our nets on ${newsSite}`);
                    tabRestoreTitleData = await replaceClickbaits(API_URL, siteConfig);
                } else if (tabRestoreTitleData != null) {
                    log(`Restoring original state of ${newsSite}`);
                    // If the conversion has not run yet, there's nothing to restore.
                    await restoreClickbaits(tabRestoreTitleData, siteConfig);
                }
                break;
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    log("Loaded");
})();
