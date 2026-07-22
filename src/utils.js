"use strict";


const browser = () => (typeof chrome !== "undefined" ? chrome : globalThis.browser);

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

const getCurrentTabHostname = async () => {
    const thisTabInfo = (await browser().tabs
        .query({ active: true, currentWindow: true }))[0];
    const thisTabUrl = new URL(thisTabInfo.url);

    return thisTabUrl.hostname;
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

export { getLogger, browser, getCurrentTabHostname, debounce, parseSemVer, sanitizeUrlForFeedback };
