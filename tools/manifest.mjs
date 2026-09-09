#!/usr/bin/env node
"use strict";

/**
 * @file manifest.mjs
 * Writes the manifest for one browser: `manifest.json` with `manifest.<browser>.json` merged onto it.
 *
 * `manifest.json` stays the base for both browsers, so the repo root remains a loadable unpacked
 * extension. An overlay names only what one browser does not accept. Merge rules: an overlay key
 * overrides the base key, objects merge level by level, `null` deletes the key, an array replaces
 * the whole array.
 *
 * `--store REV` makes the store build. AMO needs a version no unlisted build has used, so the
 * fourth version component becomes the tag's fourth component (0 when absent) plus REV: 0.0.10
 * with REV 1 is 0.0.10.1, and the hotfix 0.0.10.1 with REV 1 is 0.0.10.2. `update_url` goes,
 * because a listed AMO version must not carry one.
 *
 * Usage: node tools/manifest.mjs <chrome|firefox> [--store REV] > manifest.json
 */

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * @param {object} base
 * @param {object} overlay
 * @returns {object} A new object; neither argument is changed.
 */
export function mergeManifest(base, overlay) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        if (value === null) {
            delete merged[key];
        } else if (isObject(value) && isObject(merged[key])) {
            merged[key] = mergeManifest(merged[key], value);
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

/**
 * @param {object} manifest - A merged manifest.
 * @param {string} revision - Fourth version component of the store build.
 * @returns {object} A copy with the store version and without `update_url`.
 */
export function storeManifest(manifest, revision) {
    if (!/^[1-9]\d*$/.test(revision)) {
        throw new Error(`store revision "${revision}" is not a number above zero`);
    }
    const parts = manifest.version.split(".");
    while (parts.length < 3) parts.push("0");
    if (parts.length > 4) {
        throw new Error(`version "${manifest.version}" has more than four components`);
    }
    parts[3] = String(Number(parts[3] ?? 0) + Number(revision));

    const copy = structuredClone(manifest);
    copy.version = parts.join(".");
    // The Chrome tree has no browser_specific_settings at all; the overlay deleted it.
    if (copy.browser_specific_settings?.gecko?.update_url !== undefined) {
        delete copy.browser_specific_settings.gecko.update_url;
    }

    return copy;
}

function readJson(file) {
    return JSON.parse(readFileSync(join(REPO, file), "utf8"));
}

/**
 * @param {string} browser - `chrome` or `firefox`, naming `manifest.<browser>.json`.
 * @param {string} [revision] - Present for a store build.
 */
export function buildManifest(browser, revision) {
    const overlay = `manifest.${browser}.json`;
    let merged;
    try {
        merged = mergeManifest(readJson("manifest.json"), readJson(overlay));
    } catch (err) {
        throw new Error(`${overlay}: ${err.message}`);
    }

    return revision === undefined ? merged : storeManifest(merged, revision);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [browser, flag, revision] = process.argv.slice(2);
    if (!browser || (flag !== undefined && (flag !== "--store" || revision === undefined))) {
        console.error("Usage: node tools/manifest.mjs <chrome|firefox> [--store REV]");
        process.exit(2);
    }
    try {
        process.stdout.write(JSON.stringify(buildManifest(browser, revision), null, 2) + "\n");
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
