"use strict";

import { canRequestOrigins } from "./origins.js";

/**
 * @file provider-state.js
 * What a provider row shows about the provider's state: one tag, and the origins a "Grant access" button may request.
 *
 * DOM-free, so `make test` covers it without a browser.
 */

/** A refresh that stopped early stores errors with a `kind`. Of the resolve() errors, only a failed fetch has one. */
const KIND_TAGS = {
    build: { key: "providerTagNotInBuild", fallback: "Not in this build" },
    access: { key: "providerTagNeedsAccess", fallback: "Needs access" },
    fetch: { key: "providerTagFetchFailed", fallback: "Fetch failed" }
};
const ERRORS_TAG = { key: "providerTagErrors", fallback: "Errors" };
const REJECTED_TAG = { key: "providerTagRejected", fallback: "Rejected sites" };

/**
 * The state tag for a provider, or null when nothing is wrong.
 *
 * @param {{errors?: Array<{kind?: string}>, rejected?: Array}} data - As returned by `getProviderData()`.
 * @returns {{key: string, fallback: string}|null} The i18n message and its English fallback.
 */
export function providerStateTag(data) {
    const [error] = data.errors || [];
    if (error) return KIND_TAGS[error.kind] || ERRORS_TAG;
    return (data.rejected || []).length > 0 ? REJECTED_TAG : null;
}

/**
 * The origins a "Grant access" button requests, or null when it must not show: the provider is off (a refresh skips
 * it, so the grant would change nothing on screen), nothing is missing, or this build cannot request the origins.
 *
 * @param {{enabled: boolean}} provider
 * @param {{errors?: Array<{kind?: string, origins?: string[]}>}} data
 * @param {object} manifest - `browser.runtime.getManifest()`.
 * @returns {string[]|null}
 */
export function originsToGrant(provider, data, manifest) {
    const origins = (data.errors || []).find((error) => error.kind === "access")?.origins || [];
    if (!provider.enabled || origins.length === 0 || !canRequestOrigins(origins, manifest)) return null;
    return origins;
}
