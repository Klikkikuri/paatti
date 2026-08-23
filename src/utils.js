"use strict";


import browser from "./browser-api.js";

const getComplicatedLogger = (name) => {
    const logInitTime = Date.now();
    let lastLogTime = logInitTime;

    return (...xs) => {
        let doLogTime;
        let doTimeDifference;
        let doCumulativeTime;

        const thisLogTime = Date.now();

        // CONFIG: Comment or uncomment these in order to set different types of
        // logging TODO: Use some environment flags instead.
        //doLogTime = `🕰️ ${new Date(Date.now()).toISOString()}`
        //doTimeDifference = `Δ ${((thisLogTime - lastLogTime) / 1000).toFixed(3)}s`;
        doCumulativeTime = `∑ ${((thisLogTime - logInitTime) / 1000).toFixed(3)}s`;

        lastLogTime = thisLogTime;

        const logPrompt = `Loki ⛵ ${name.padEnd(10)}`;
        const args = [
            logPrompt,
            doLogTime,
            ((doTimeDifference || doCumulativeTime) ? "⏱️" : undefined),
            doTimeDifference,
            doCumulativeTime,
            ">",
        ].filter((x) => x !== undefined);
        console.log.bind(console)(...args, ...xs);
    };
};

const getLogger = (name) => {
    // CONFIG: Switch the commenting of these different loggings if you like.
    //return getComplicatedLogger(name);
    return console.log.bind(console, `[Loki ⛵ ${name}]:`);
};

/**
 * Safely queries and returns the currently active tab across desktop and mobile browsers.
 *
 * Tries `currentWindow: true` first, falling back to a general `{ active: true }` query
 * to reliably handle mobile environments such as Firefox for Android.
 *
 * @returns {Promise<browser.tabs.Tab|null>} The active tab object or null.
 */
const getActiveTab = async () => {
    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs.length > 0 && tabs[0]) return tabs[0];
    } catch (e) {
        // Fallback to active query below
    }
    try {
        const tabs = await browser.tabs.query({ active: true });
        if (tabs && tabs.length > 0 && tabs[0]) return tabs[0];
    } catch (e) {
        // Ignore
    }
    return null;
};

/**
 * Retrieves the hostname of the currently active browser tab.
 *
 * @returns {Promise<string|null>} The hostname or null if unable to determine.
 */
const getCurrentTabHostname = async () => {
    try {
        const tab = await getActiveTab();
        if (!tab || !tab.url) {
            return null;
        }
        const thisTabUrl = new URL(tab.url);
        return thisTabUrl.hostname;
    } catch (e) {
        return null;
    }
};

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

/**
 * Parses a semantic version string into major, minor, and patch components.
 *
 * @param {string} versionString - The version string to parse (e.g. "1.2.3").
 * @returns {{major: number, minor: number, patch: number}|null} The parsed SemVer object, or null if parsing fails.
 */
const parseSemVer = (versionString) => {
    if (!versionString || typeof versionString !== "string") {
        return null;
    }
    const parts = versionString.split(".");
    const major = parseInt(parts[0], 10);
    const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    const patch = parts.length > 2 ? parseInt(parts[2], 10) : 0;

    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
        return null;
    }
    return { major, minor, patch };
};

/**
 * Common tracking query parameter keys grouped by type.
 */
const TRACKING_KEYS = new Set([
    // campaign
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "utm_source_platform",
    // click_id
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "twclid", "yclid",
    // referral
    "ref", "ref_src", "ref_url",
    // session
    "sid", "session_id", "sessionid", "phpsessid", "jsessionid", "aspsessionid",
    // social & email
    "mc_eid", "igshid", "mkt_tok"
]);

/**
 * Sanitizes a page URL for feedback submission by stripping common tracking query parameters
 * (e.g., utm_*, fbclid, gclid, ref, session tokens).
 *
 * @param {string} urlStr - The URL string to sanitize.
 * @returns {string} The sanitized URL string, or the original string if parsing fails.
 */
const sanitizeUrlForFeedback = (urlStr) => {
    if (!urlStr || typeof urlStr !== "string") {
        return urlStr || "";
    }

    try {
        const parsed = new URL(urlStr);

        const trackingKeys = [];
        for (const key of parsed.searchParams.keys()) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.startsWith("utm_") || TRACKING_KEYS.has(lowerKey)) {
                trackingKeys.push(key);
            }
        }

        trackingKeys.forEach(key => parsed.searchParams.delete(key));

        return parsed.toString();
    } catch {
        return urlStr;
    }
};

/**
 * Detects whether a DOM element can safely accept HTML <span> child elements.
 *
 * @param {Element|Node} elem - The target DOM element.
 * @returns {boolean} True if HTML <span> child nodes can be appended, false if plain text must be used.
 */
const canAppendSpan = (elem) => {
    if (!elem || elem.nodeType !== 1) return false;

    // Reject non-HTML namespaces (e.g., SVG elements)
    if (elem.namespaceURI && elem.namespaceURI === "http://www.w3.org/2000/svg") return false;

    // Reject text-only/form elements
    const tagName = elem.tagName ? elem.tagName.toUpperCase() : "";
    const textOnlyTags = new Set(["INPUT", "TEXTAREA", "OPTION", "TITLE", "STYLE", "SCRIPT", "SELECT"]);
    if (textOnlyTags.has(tagName)) return false;

    return typeof elem.replaceChildren === "function";
};

export { getLogger, getActiveTab, getCurrentTabHostname, debounce, parseSemVer, sanitizeUrlForFeedback, canAppendSpan };

