"use strict";

const log = getLogger("content_script");

/**
 * Copied from:
 * https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest#converting_a_digest_to_a_hex_string
 */
var hashUrl = async (url) => {
    const encoder = new TextEncoder();
    const msgUint8 = encoder.encode(url); // encode as (utf-8) Uint8Array
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

        const articleUrl = link.href;
        // TODO START mock generating hashes that would be found in the data.json.
        // TODO: Use real URLs hashes once there's a backend delivering real data.
        //const articleUrl = ["a", "b", "c", "d", "e", "f"][Array.from(link.href).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6]+ "\n";
        // TODO END

        const linkHash = await hashUrl(articleUrl);

        log(linkHash);
        if (!titleData[linkHash]) {
            titleData[linkHash] = {
                title: (titleData[linkHash]?.title != undefined)
                    ? titleData[linkHash].title
                    : titleData[titleData[linkHash].canonical].title
            };
        }

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
    let apiResponse;
    try {
        apiResponse = await fetch(apiUrl);
    } catch (e) {
        log(`Failed to fetch data from the API: ${e}`);
        return;
    }
    const titleData = (await apiResponse.json()).hashesToTitles;
    log(titleData);

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


/**
 * Builder function that returns function to preprocess a news-URL into a hash
 * that correctly indexes to converted title data.
 */
const getHashUrl = (suola) => {
    return (url) => {
        // TODO: Write the url to __STATIC__ WASM memory (fixed size, no
        // allocation), processe it and return the computed hash.
        const memory = new Uint8Array(suola.instance.exports.memory.buffer);
        const bufferStart = suola.instance.exports.get_url_ptr();
        for (const i in url) {
            log(memory[bufferStart + i]);
            memory[bufferStart + i] = url.charCodeAt(i);
        }
        // Terminate the string.
        memory[bufferStart + url.length] = 0;

        const returnCode = suola.instance.exports.static_normalize_and_hash_url();
        if (returnCode != 0) {
            log(`Failed to hash the URL '${url}' with status code: `, returnCode);
            return;
        };

        let sha256Hash = "";
        const SHA256_LENGTH = 64;
        for (let i = 0; i < SHA256_LENGTH; i++) {
            sha256Hash += String.fromCharCode(memory[bufferStart + i]);
        };
        log(`Hash for ${url} == ${sha256Hash}`);
    };
}

// Main.
(async () => {
    // Initialize WebAssembly components.
    const suolaPath = browser.runtime.getURL("lib/suola.wasm");
    try {
        const suola = await WebAssembly.instantiateStreaming(fetch(suolaPath));
        log(suola);
        // Redefine the function in global scope.
        hashUrl = getHashUrl(suola);
    } catch (e) {
        log(`[🧂 suola]: Failed loading WebAssembly function: ${e}`);
        //TODO return?
    }

    // TODO: Read this from a config for dev and prod environments somehow?
    const API_URL = "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json";

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
