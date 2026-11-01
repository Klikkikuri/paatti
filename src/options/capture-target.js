"use strict";

/**
 * @file capture-target.js
 * Where the popup may send the links of the current page: the capture endpoint of a local provider. Also how the
 * popup reads a page where the content script does not run.
 *
 * Kept apart from popup.js so that it can be tested on its own; only `capturePageLinks` reads a DOM, the page's. The
 * endpoint comes only from a provider manifest that the user added, and it must be on the user's own machine:
 * `safeFetch` with `allowLoopback` still allows a public host, so a loopback manifest could otherwise name a remote
 * one.
 */

import { isLoopbackHost } from "../safe-fetch.js";

/** The manifest link relation that names a development server's capture endpoint. */
export const CAPTURE_REL = "x-paatti-dev-capture";

const onLoopback = (url) => {
    try {
        return isLoopbackHost(new URL(url).hostname);
    } catch {
        return false;
    }
};

/**
 * The first enabled loopback provider that names a loopback capture endpoint, in the development environment only.
 *
 * @param {object} config - As returned by `getConfig()`.
 * @returns {{providerUrl: string, captureUrl: string}|null}
 */
export function captureTarget(config) {
    if (config.activeEnv !== "development" || !config.loopbackProvidersEnabled) return null;
    for (const providerUrl of config.enabledProviderUrls || []) {
        if (!onLoopback(providerUrl)) continue;
        const link = (config.providerData?.[providerUrl]?.links || []).find((candidate) => candidate.rel === CAPTURE_REL);
        if (link && onLoopback(link.href)) return { providerUrl, captureUrl: link.href };
    }
    return null;
}

/**
 * The site rule that the popup reads a page with when no provider supplies its site: each link is its own headline.
 * The development server serves it back as the rule of the captured site.
 */
export const GENERIC_CAPTURE_RULE = Object.freeze({
    description: "Any link with text (development server capture)",
    container: "a[href]",
    link: "self",
    title: "self"
});

/**
 * The http(s) links that `rules` find on the page, with their headlines, as the content script's `capturePage`
 * returns them. The scan follows `scanSiteRules` in `src/site-rules-scan.js`; this copy stays self-contained
 * because the popup injects the function into a page, where no import is available. It runs in the page through
 * `scripting.executeScript`, so it uses nothing from this module.
 *
 * @param {object[]} rules - The site's rules, or `[GENERIC_CAPTURE_RULE]`.
 * @returns {{pageUrl: string, rules: object[], links: Array<{href: string, title: string}>}}
 */
export function capturePageLinks(rules) {
    const isSelf = (selector) => selector === "self" || selector === ":scope";
    const links = [];
    for (const rule of rules) {
        for (const container of document.querySelectorAll(rule.container)) {
            const ruleLinks = !rule.link || isSelf(rule.link) ? [container] : container.querySelectorAll(rule.link);
            for (const link of ruleLinks) {
                const titleElem = isSelf(rule.title) ? container : (rule.title ? container.querySelector(rule.title) : link);
                const title = titleElem?.textContent.trim();
                if (title && /^https?:/.test(link.href)) links.push({ href: link.href, title });
            }
        }
    }
    return { pageUrl: window.location.href, rules, links };
}
