/**
 * @fileoverview Facade for reading Rahti title-correction entries.
 *
 * The fetch/refresh side used to live here too, but the official Rahti dataset is now just another
 * entry in the provider mechanism (see config.js's `defaultProviders` and providers.js's
 * `refreshOne`/`refreshProviders`) -- this file only reads what that mechanism already resolved.
 */

import { getConfig } from "./config.js";
import { initStorage } from "./storage.js";
import { model } from "./model.js";
import { namespaceFor } from "./providers.js";

/**
 * The Rahti entry for `sign`, scoped by the host of the link it signs rather than the page's -- so a
 * provider can correct a site it does not run without also being able to answer for a link on any page
 * that happens to reference it. See model.read.getSourceForHost for the precedence this follows: a
 * provider whose own site-configs claims the host, or the active environment's default provider(s)
 * otherwise.
 *
 * Multiple default providers merge with the same precedence `titleDataUrls` used to have: later entries
 * in `config.defaultProviders` win on a colliding sign.
 *
 * @param {string} sign
 * @param {string} linkHost
 * @returns {Promise<object|null>}
 */
async function getRahtiEntry(sign, linkHost) {
    const source = await model.read.getSourceForHost(linkHost);
    const config = await getConfig();

    const candidates = source ? [source] : (config.defaultProviders || []); // defensive: never assume shape

    let entry = null;
    for (const url of candidates) {
        if (!config.enabledProviderUrls.includes(url)) continue;
        const providerStorage = await initStorage(namespaceFor(url));
        const providerRahtiData = await providerStorage.get("rahtiData");
        const hit = providerRahtiData?.[sign];
        if (hit !== undefined) entry = hit; // later entries win, matching titleDataUrls' old merge order
    }
    return entry;
}

export { getRahtiEntry };
