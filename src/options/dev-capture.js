"use strict";

/**
 * @file dev-capture.js
 * The devmode (development-only; see docs/PRIVACY_POLICY_DEVELOPMENT.md) capture that sends the page's
 * links and headlines to a local provider's capture endpoint, then re-reads and converts the page with
 * the corrections that the provider signs.
 *
 * The rules for developing a site this way are in docs/development/adding-a-new-site.md, section 1. The
 * feature is dormant in a store install: `captureTarget` returns a target only in the `development`
 * environment against a loopback provider that names `x-paatti-dev-capture` (docs/amo-reviewer-notes.md
 * carries the same note for reviewers).
 */

import browser from "../browser-api.js";
import { getLogger } from "../utils.js";
import { model } from "../model.js";
import { controller } from "../controller.js";
import { getConfig } from "../config.js";
import { safeFetch } from "../safe-fetch.js";
import { originPatterns } from "./origins.js";
import { pointDocLinks } from "./utils.js";
import { captureTarget, capturePageLinks, GENERIC_CAPTURE_RULE } from "./capture-target.js";

const log = getLogger("dev-capture");

/**
 * What the capture button sends and where, from the last refresh. The click handler reads it without an `await`,
 * because a permission request needs the click's user gesture. Null when the row is hidden.
 *
 * @type {{target: {providerUrl: string, captureUrl: string}, tabId: number, origin: string, canScan: boolean,
 *   rules: object[]}|null}
 */
let captureContext = null;

/** Bind the popup's capture controls and the privacy notice link. Call once when the popup loads. */
export function setupDevCapture() {
    document.getElementById("devmode-capture-button").addEventListener("click", devmodeCapturePage);
    // The privacy notice link of the devmode section carries a data-doc, like the options page's links.
    pointDocLinks();
}

/**
 * The devmode (development-only; see docs/PRIVACY_POLICY_DEVELOPMENT.md) capture row: shown on an http(s) page
 * when a local provider names a capture endpoint. Called once per popup refresh, with what that refresh read.
 *
 * @param {object} options
 * @param {object} options.config - As returned by `getConfig()`.
 * @param {browser.tabs.Tab|null} options.tab - The active tab.
 * @param {string|null} options.matchingDomain - The site of the page, if a provider supplies it.
 * @param {boolean} options.canScan - The content script runs on the page: its site is on.
 */
export function refreshDevCapture({ config, tab, matchingDomain, canScan }) {
    const target = captureTarget(config);
    const [origin] = originPatterns([tab?.url ?? ""]);
    const rules = matchingDomain ? config.siteConfigs[matchingDomain].rules : [GENERIC_CAPTURE_RULE];
    captureContext = target && origin ? { target, tabId: tab.id, origin, canScan, rules } : null;
    document.getElementById("devmode-capture").classList.toggle("hidden", !captureContext);
}

/**
 * A capture reply the popup can send: what `capturePageLinks` and the content script's `capturePage` answer.
 * Either source can fail to produce one — the content script answers null on an internal error, and the injected
 * function returns undefined when its frame is gone — so the shape is checked here, at the boundary.
 *
 * @param {unknown} page
 * @returns {boolean}
 */
function isCaptureReply(page) {
    return typeof page === "object" && page !== null
        && typeof page.pageUrl === "string"
        && Array.isArray(page.rules)
        && Array.isArray(page.links);
}

/**
 * Send the site rules, links and headlines of the page to the development server, update the database, and convert
 * the page with the corrections that the server made.
 *
 * When the content script does not run on the page, the popup first asks for the page's origin, reads the page with
 * `capturePageLinks`, and at the end starts the content script in the tab.
 *
 * @param {MouseEvent} event - The click on `devmode-capture-button`.
 */
async function devmodeCapturePage(event) {
    const context = captureContext;
    if (!context) return;
    const granted = context.canScan || browser.permissions.request({ origins: [context.origin] });

    const button = event.currentTarget;
    const status = document.getElementById("devmode-capture-status");
    button.disabled = true;
    status.textContent = browser.i18n.getMessage("devmodeCaptureSending");
    try {
        if (!(await granted)) throw new Error(browser.i18n.getMessage("permissionNotGranted"));
        const page = context.canScan
            ? await captureRunningPage(context.tabId)
            : (await browser.scripting.executeScript({
                target: { tabId: context.tabId }, func: capturePageLinks, args: [context.rules]
            }))[0].result;
        if (!isCaptureReply(page)) throw new Error(browser.i18n.getMessage("devmodeCaptureNoReply"));
        const response = await safeFetch(context.target.captureUrl, {
            allowLoopback: true,
            init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(page) }
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(typeof result.detail === "string" ? result.detail : `HTTP ${response.status}`);
        }

        const updated = await browser.runtime.sendMessage({ action: "updateDatabase" });
        if (!updated?.success) throw new Error(updated?.error || browser.i18n.getMessage("devmodeCaptureNoUpdate"));
        // updateDatabase reports only the default providers; the provider's own errors say whether it refreshed.
        const errors = (await getConfig()).providerData[context.target.providerUrl]?.errors || [];
        if (errors.length > 0) throw new Error(errors.map((error) => error.message).join("; "));

        // The provider now supplies the site, and a site that a provider supplies starts off.
        const domain = await model.read.getMatchingSiteDomain(new URL(page.pageUrl).hostname);
        if (!domain) throw new Error(browser.i18n.getMessage("devmodeCaptureNoProvider", [page.pageUrl]));
        await controller.setSiteEnabled(true, domain);
        if (context.canScan) {
            await browser.tabs.sendMessage(context.tabId, { command: "convertClickbaits" });
        } else {
            await browser.scripting.executeScript({ target: { tabId: context.tabId }, files: ["src/contentScript.js"] });
        }
        status.textContent = browser.i18n.getMessage("devmodeCaptureDone", [String(result.links)]);
    } catch (err) {
        log("Sending the page to the development server failed:", err);
        status.textContent = browser.i18n.getMessage("devmodeCaptureFailed", [err.message]);
    } finally {
        button.disabled = false;
    }
}

/**
 * The site rules and links of a page that the content script already runs on. Part of the devmode capture, like
 * `refreshDevCapture`.
 *
 * @param {number} tabId - The tab whose content script scanned the page.
 * @returns {Promise<{pageUrl: string, rules: object[], links: Array<{href: string, title: string}>}>}
 */
function captureRunningPage(tabId) {
    return browser.tabs.sendMessage(tabId, { command: "capturePage" });
}
