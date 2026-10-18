"use strict";

/**
 * @file capture-target.js
 * Where the popup may send the links of the current page: the capture endpoint of a local provider.
 *
 * Kept apart from popup.js and free of the DOM so that the rule can be tested on its own. The endpoint comes only
 * from a provider manifest that the user added, and it must be on the user's own machine: `safeFetch` with
 * `allowLoopback` still allows a public host, so a loopback manifest could otherwise name a remote one.
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
