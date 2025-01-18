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

/**
 * Filter out the links not processed in backend.
 */
const getReplaceableTitleElements = async (titleData) => {
    const newsSite = window.location.hostname;

    const siteConfigs = await browser.storage.local.get("siteConfigs");
    const siteConfig = siteConfigs["siteConfigs"][newsSite];
    log("Site config:", siteConfig);
    if (siteConfig == undefined) {
        log(`'${newsSite}' is not supported.`);
        return [];
    }

    // Guard against running on unenabled site.
    if (!siteConfig["enabled"]) {
        log(`Processing ${newsSite} is disabled`);
        return [];
    }

    log(`Casting our nets on ${newsSite}`);

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

const replaceClickbaits = async (apiUrl) => {
    const apiResponse = await fetch(apiUrl);
    const titleData = (await apiResponse.json()).hashesToTitles;
    log(titleData);

    for (const {titleElem, canonicalHash} of await getReplaceableTitleElements(titleData)) {
        // Store the original title in memory for converting back.
        titleData[canonicalHash].restoreTitle = titleElem.textContent;

        titleElem.textContent = titleData[canonicalHash].title;
    }

    return titleData;
};

const restoreClickbaits = async (titleData) => {
    for (const {titleElem, canonicalHash} of await getReplaceableTitleElements(titleData)) {
        titleElem.textContent = titleData[canonicalHash].restoreTitle;
    }
};

// Main.
(async () => {
    const API_URL = "http://localhost:8000/headlines/testData.json";

    // TODO: How to perform first conversion at page load time based on
    // localstorage settings (can't seem to read localstorage in this script)?
    let tabRestoreTitleData = null;

    /**
     * Listen for messages from the background script.
     */
    browser.runtime.onMessage.addListener(async (message) => {
        log("Received message:", message);
        switch (message.command) {
            case "replaceClickbaits":
                tabRestoreTitleData = await replaceClickbaits(API_URL);
                break;
            case "restoreClickbaits":
                if (tabRestoreTitleData != null) {
                    // If the conversion has not run yet, there's nothing to restore.
                    await restoreClickbaits(tabRestoreTitleData);
                }
                break;
            default:
                log(`Unknown command '${message.command}'`);
                break;
        }
    });

    log("Loaded");
})();
