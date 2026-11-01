/**
 * @file captures.mjs
 * The capture files the server writes asynchronously: poll until both `sites.json` and `links.json` exist, then
 * read them.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { waitUntil } from "./waits.mjs";

/** One stored capture of a link: the page's original headline at the moment of the send.
 * @typedef {{title: string, captured: string}} CapturedLink
 */

/** One stored site: the selectors Paatti sent, and the origins the site claimed.
 * @typedef {{name: string, origins: string[], rules: Array<Record<string, unknown>>}} CapturedSite
 */

/**
 * The stored sites of `host`: their selectors and granted origins.
 *
 * @param {string} dataDir
 * @param {string} host
 * @returns {Promise<Record<string, CapturedSite>>}
 */
export async function readSites(dataDir, host) {
    const text = await readFile(join(dataDir, "captures", host, "sites.json"), "utf8");
    return (JSON.parse(text)).sites;
}

/**
 * The stored links of `host`, by their absolute URL.
 *
 * @param {string} dataDir
 * @param {string} host
 * @returns {Promise<Record<string, CapturedLink>>}
 */
export async function readLinks(dataDir, host) {
    const text = await readFile(join(dataDir, "captures", host, "links.json"), "utf8");
    return JSON.parse(text);
}

/**
 * Waits until a host's capture folder exists and both files carry content, then reads them together. Throws when
 * they never arrive: `waitUntil` reports a timeout instead of returning a falsy last value.
 *
 * @param {string} dataDir
 * @param {string} host
 * @returns {Promise<{sites: Record<string, CapturedSite>, links: Record<string, CapturedLink>}>}
 */
export async function waitForCaptures(dataDir, host) {
    return await waitUntil(async () => {
        try {
            const sites = await readSites(dataDir, host);
            const links = await readLinks(dataDir, host);
            return Object.keys(sites).length > 0 && Object.keys(links).length > 0 ? { sites, links } : null;
        } catch {
            return null; // The files are not there yet, or one arrived before the other.
        }
    }, 30000);
}
