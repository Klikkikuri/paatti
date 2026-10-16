"use strict";

/**
 * @file site-links.js
 * Which `links` of a site configuration the options page shows, and with which label.
 *
 * DOM-free and import-free, so `make test` covers it without a browser.
 */

/** The i18n message that labels a known `rel`. A link with another `rel` uses its own `title`, or is not shown. */
const REL_MESSAGES = {
    "about": "linkAboutText",
    "privacy-policy": "linkPrivacyPolicyText",
    "terms-of-service": "linkTermsOfServiceText",
    "license": "linkLicenseText",
    "x-publisher-policy": "sitePolicyLinkText"
};

/** Not a document to read: never shown, even with a `title`. */
const HIDDEN_RELS = new Set(["icon"]);

const isHttpUrl = (href) => /^https?:\/\//i.test(href ?? "");

/**
 * One link for each `rel`, in document order. Of the links with the same `rel`, the one whose `hreflang` agrees
 * with the user interface language wins; otherwise the first.
 *
 * @param {Array<{rel: string, href: string, hreflang?: string, title?: string}>} links
 * @param {string} uiLanguage - For example `fi` or `en-US`.
 * @param {(key: string) => string} getMessage - `browser.i18n.getMessage`.
 * @returns {Array<{href: string, label: string}>}
 */
export function siteLinks(links, uiLanguage, getMessage) {
    const language = uiLanguage.toLowerCase().split("-")[0];
    const byRel = new Map();
    for (const link of (links || []).filter((link) => isHttpUrl(link?.href) && !HIDDEN_RELS.has(link.rel))) {
        const chosen = byRel.get(link.rel);
        const matches = (link.hreflang || "").toLowerCase().split("-")[0] === language;
        if (!chosen || (matches && !chosen.matches)) byRel.set(link.rel, { link, matches });
    }

    return [...byRel.entries()].flatMap(([rel, { link }]) => {
        const label = (REL_MESSAGES[rel] && getMessage(REL_MESSAGES[rel])) || link.title;
        return label ? [{ href: link.href, label }] : [];
    });
}
