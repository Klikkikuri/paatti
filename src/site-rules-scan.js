"use strict";

/**
 * @file site-rules-scan.js
 * The semantics of a site rule: which containers and links its selectors find, and how the extension decides
 * what one Rahti entry does to a link. DOM-free and randomness-free, so `make test` covers it and every
 * consumer shares one definition.
 *
 * Two consumers cannot import this module and must keep their own copy of these few lines:
 * `capturePageLinks` in `src/options/capture-target.js` — the popup injects it into a page as a function object,
 * where no import is available — and the scan in `tools/devserver-drift.mjs`, independent from the server's
 * expectations on purpose (see that file's header). Both use the named constants here.
 */

import { DEFAULT_CLICKBAIT_LEVEL, LABEL_PAYWALLED, LEVELS } from "./clickbait-constants.js";

/** Whether a rule's selector means "the container itself" rather than a query below it. */
export function isSelfSelector(selector) {
    return selector === "self" || selector === ":scope";
}

/**
 * Every link that `rules` find in `document`: each matched container, and each link in it with its title element,
 * which is null when the rule's title selector finds nothing. `href` is resolved against `pageUrl` — the form the
 * extension signs and looks up — or null for an address that does not parse.
 *
 * @param {Document|ParentNode} document
 * @param {object[]} rules - Site rules with `container`, optional `link` and `title` selectors.
 * @param {string} [pageUrl] - The page the scan runs on; defaults to the document's own location.
 * @returns {Array<{container: Element, link: Element, titleElem: Element|null, href: string|null}>}
 */
export function scanSiteRules(document, rules, pageUrl) {
    const base = pageUrl ?? document?.location?.href;
    const resolveHref = (raw) => {
        if (!raw || !base) return raw ?? null;
        try {
            return new URL(raw, base).href;
        } catch {
            return null;
        }
    };
    const found = [];
    for (const rule of rules) {
        for (const container of document.querySelectorAll(rule.container)) {
            const links = (!rule.link || isSelfSelector(rule.link)) ? [container] : container.querySelectorAll(rule.link);
            for (const link of links) {
                const titleElem = isSelfSelector(rule.title)
                    ? container
                    : (rule.title ? container.querySelector(rule.title) : link);
                found.push({ container, link, titleElem, href: resolveHref(link.getAttribute("href")) });
            }
        }
    }
    return found;
}

/**
 * The status one scanned link gets under one Rahti entry: skipped without a headline, a sign, or an entry;
 * converted when the entry carries a title at or above the threshold; paywalled when it has no title but the
 * paywall label; original otherwise. This mirrors the decision in `processSite` (`src/contentScript.js`).
 *
 * @param {{titleElem: Element|null, href: string|null}} scanned - One item of `scanSiteRules`.
 * @param {object|null} entry - The Rahti entry under the link's sign, or null when there is none.
 * @param {string|null} sign - The link's sign, or null when it has no usable href.
 * @param {number} [threshold] - The clickbait level at or above which a title is swapped.
 * @returns {"skipped"|"converted"|"paywalled"|"original"}
 */
export function decideStatus(scanned, entry, sign, threshold = DEFAULT_CLICKBAIT_LEVEL) {
    if (!scanned.titleElem || !scanned.href || !sign) return "skipped";
    if (!entry) return "skipped";
    const level = LEVELS.indexOf(entry.clickbaitiness);
    if (entry.title && level !== -1 && level >= threshold) return "converted";
    if (!entry.title && entry.labels?.includes(LABEL_PAYWALLED)) return "paywalled";
    return "original";
}
