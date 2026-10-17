"use strict";

/**
 * Feedback payload construction, shared by the popup's feedback list and the in-page dialog.
 *
 * DOM-free on purpose, so `make test` can cover it: this logic decides what leaves the browser and had no tests
 * at all while it lived inside the popup component.
 *
 * The network call is not here either. `buildFeedbackRequest` returns the request as data and the service
 * worker performs it, so both entry points send byte-identical submissions through one place. A content script
 * could post this itself -- an isolated world is exempt from the visited page's CSP, unlike the main world --
 * but that exemption has differed between browsers, and the worker needs none of it.
 */

import { Clickbaitiness } from "./model.js";

/** Badge labels, mirroring _locales/en so a missing translation degrades to English. */
const LEVEL_FALLBACKS = ["Neutral", "Low", "Medium", "High", "Extreme"];

/** Google Form field ids, in payload order. */
const FORM_ENTRIES = {
    pageUrl: "entry.1944615860",
    urlSign: "entry.1369854914",
    originalTitle: "entry.917360051",
    convertedTitle: "entry.1935829065",
    clickbaitLevel: "entry.1807257025",
    feedbackType: "entry.167673994",
    comment: "entry.78795748",
    databaseUpdated: "entry.364993842"
};

/**
 * The page URL as feedback sends it: origin and path, without the query or the fragment. Those can carry
 * search terms, tokens or IDs that tell more about the user than about the headline.
 *
 * @param {string} url
 * @returns {string} The trimmed URL, or the input unchanged when it does not parse.
 */
function feedbackPageUrl(url) {
    try {
        const { origin, pathname } = new URL(url);
        // Known limits: a page that identifies its content only in the query loses that identification, and data
        // in the path (for example ";jsessionid=") is still sent. Accepted for now: urlSign identifies the headline,
        // and supported news sites do not put user data in their paths.
        return origin + pathname;
    } catch {
        return url;
    }
}

/**
 * Resolve a clickbait level -- numeric, or a Clickbaitiness level string -- to the index used as the badge's
 * colour key and its label's i18n suffix. The i18n lookup stays with the caller, so this module needs no
 * `browser`.
 *
 * Anything unrecognised is treated as the most severe level.
 *
 * @param {number|string} level
 * @returns {{index: number, fallback: string}}
 */
export function clickbaitBadgeIndex(level) {
    let index = Clickbaitiness.stringToNumber(level);
    if (index < 0) {
        index = Number.parseInt(level, 10);
    }
    if (!Number.isInteger(index) || index < 0 || index >= LEVEL_FALLBACKS.length) {
        index = LEVEL_FALLBACKS.length - 1;
    }
    return { index, fallback: LEVEL_FALLBACKS[index] };
}

/**
 * Validate and normalise one feedback submission.
 *
 * The page, the headline, its clickbait level and the feedback type are required. The comment is trimmed once, here, and the trimmed value is what both the form and
 * the JSON body carry -- the JSON branch used to send the raw string, so a whitespace-only comment passed
 * validation on its "-" placeholder and then posted as blank.
 *
 * Nothing in the payload may link two submissions from one install. The page URL keeps only its origin and
 * path (see `feedbackPageUrl`), and `databaseUpdated` is the generation date of the dataset in use, which is
 * the same for every install on that dataset. The install's own download time would be unique to it.
 *
 * @param {object} fields
 * @param {object} fields.databaseStatus - From `model.read.getDatabaseStatus()`.
 * @returns {object|null} The payload, or null when a required field is missing.
 */
export function buildFeedbackPayload({
    pageUrl,
    urlSign,
    originalTitle,
    convertedTitle,
    clickbaitLevel,
    feedbackType,
    comment = "",
    databaseStatus
}) {
    const payload = {
        timestamp: new Date().toISOString(),
        pageUrl: feedbackPageUrl(pageUrl || ""),
        urlSign: urlSign || "",
        originalTitle: originalTitle || "",
        convertedTitle: convertedTitle || "",
        clickbaitLevel: (clickbaitLevel !== undefined && clickbaitLevel !== null) ? String(clickbaitLevel) : "",
        feedbackType: feedbackType || "",
        comment: String(comment).trim() || "-",
        databaseUpdated: databaseStatus?.databaseGenerationDate || "Unknown"
    };

    const required = ["pageUrl", "urlSign", "originalTitle", "convertedTitle", "feedbackType"];
    if (required.some((key) => !payload[key]) || payload.clickbaitLevel === "") {
        return null;
    }

    return payload;
}

/**
 * Whether a feedback endpoint is a Google Form, which takes urlencoded `entry.*` fields rather than JSON.
 *
 * Internal: `buildFeedbackRequest` is the whole public surface, and both branches are covered through it.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isGoogleForm(url) {
    return typeof url === "string" && url.includes("docs.google.com/forms");
}

/**
 * Rewrite a Google Form URL to the endpoint that accepts a submission. Internal, as `isGoogleForm` is.
 *
 * @param {string} url
 * @returns {string}
 */
function googleFormPostUrl(url) {
    if (url.endsWith("/formResponse")) return url;
    if (url.endsWith("/viewform")) return url.replace("/viewform", "/formResponse");
    return url.endsWith("/") ? `${url}formResponse` : `${url}/formResponse`;
}

/**
 * The request a caller should make for this payload. Returned as data rather than performed here, so the
 * service worker owns the one `fetch` and both entry points describe it identically.
 *
 * `mode: "no-cors"` makes the response opaque, so a caller can only report whether the request threw.
 *
 * @param {string} feedbackServerUrl
 * @param {object} payload - From `buildFeedbackPayload`.
 * @returns {{url: string, init: RequestInit}}
 */
export function buildFeedbackRequest(feedbackServerUrl, payload) {
    const common = {
        method: "POST",
        mode: "no-cors",
        referrerPolicy: "no-referrer",
        credentials: "omit"
    };

    if (isGoogleForm(feedbackServerUrl)) {
        const body = new URLSearchParams();
        for (const [field, entry] of Object.entries(FORM_ENTRIES)) {
            body.append(entry, payload[field]);
        }
        return {
            url: googleFormPostUrl(feedbackServerUrl),
            init: { ...common, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }
        };
    }

    return {
        url: feedbackServerUrl,
        init: { ...common, headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload) }
    };
}
