#!/usr/bin/env node
"use strict";

/**
 * @file sites.mjs
 * Writes the bundled site configurations from a provider manifest, and the manifest origins they need.
 *
 * The site configurations live in Rahti's `sites.json`, linked from the official provider manifest. This script
 * resolves the manifest with `src/provider.js`, so the bundled set passes the same validation as a provider at
 * runtime, and writes the result to `src/generated/sites.js`. The module is committed: the repo root is itself a
 * loadable unpacked extension, and there is no bundler to fetch it at load time.
 *
 * It also writes the site origins into `manifest.json`: an enabled site into `host_permissions`, a disabled site
 * into `optional_host_permissions`, and every site into the `matches` of the named `web_accessible_resources`
 * group. A store build cannot request any other origin, so these lists are never edited by hand. An entry of the
 * form `https://<host>/*` belongs to this script; every other entry is kept.
 *
 * An origin that is optional in the previous release stays optional, also when its site becomes enabled. A new
 * required host permission makes Chrome disable the extension at update until the user accepts it. The previous
 * release is the last `v*` tag before HEAD, so that `--check` gives the same result on the tagged commit. A source
 * archive has no git history: then the committed `manifest.json` takes the place of the previous release.
 *
 * Usage:
 *   node tools/sites.mjs <manifest-url>                   write the module and the manifest origins
 *   node tools/sites.mjs --check                          fail if manifest.json does not agree with the module
 *   node tools/sites.mjs --check-published <manifest-url> fail if the module differs from the published sites
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";

import { fetchManifest, resolve } from "../src/provider.js";
import { ARBITRARY_ORIGINS } from "../src/options/origins.js";

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = join("src", "generated", "sites.js");
const MANIFEST = "manifest.json";

const SITE_ORIGIN = /^https?:\/\/(\*\.)?[^/*]+\/\*$/;

/**
 * Fetch and resolve the site configurations of a provider manifest. Loopback is allowed: this runs on a
 * developer's machine, and a local Rahti checkout is served from there.
 *
 * @param {string} url
 * @returns {Promise<object>} The site configurations, keyed by host.
 */
export async function fetchSites(url) {
    const options = { loopbackProvidersEnabled: true };
    const { manifest, error } = await fetchManifest(url, options.loopbackProvidersEnabled);
    if (error) throw new Error(`${url}: ${error}`);

    const result = await resolve(manifest, url, options);
    const problems = [
        ...result.errors.filter((e) => e.type === "site-configs").map((e) => e.message),
        ...result.rejected.map((r) => JSON.stringify(r)),
    ];
    if (problems.length > 0) throw new Error(`${url}: site configurations refused:\n  ${problems.join("\n  ")}`);
    if (Object.keys(result.siteConfigs).length === 0) throw new Error(`${url}: no site configurations`);

    return result.siteConfigs;
}

/**
 * @param {object} manifest - `manifest.json`.
 * @param {object} siteConfigs
 * @param {object} released - `manifest.json` of the previous release.
 * @returns {object} A copy whose site origins are the origins of `siteConfigs`.
 */
export function patchManifest(manifest, siteConfigs, released) {
    const shippedOptional = new Set(released.optional_host_permissions);
    const sites = Object.values(siteConfigs);
    const enabled = sites.filter((site) => site.enabled).flatMap((site) => site.origins);
    const disabled = sites.filter((site) => !site.enabled).flatMap((site) => site.origins);
    const required = enabled.filter((origin) => !shippedOptional.has(origin));
    const optional = [...enabled.filter((origin) => shippedOptional.has(origin)), ...disabled];
    const keep = (list = []) => list.filter((origin) => !SITE_ORIGIN.test(origin));

    const copy = structuredClone(manifest);
    copy.host_permissions = [...keep(manifest.host_permissions), ...required];
    copy.optional_host_permissions = [...keep(manifest.optional_host_permissions), ...optional];
    const named = copy.web_accessible_resources.find((group) => !group.matches.includes(ARBITRARY_ORIGINS));
    named.matches = [...enabled, ...disabled];

    return copy;
}

/**
 * @param {object} bundled
 * @param {object} published
 * @returns {string[]} One line for each site that is added, removed or changed.
 */
export function diffSites(bundled, published) {
    const keys = new Set([...Object.keys(bundled), ...Object.keys(published)]);
    return [...keys].flatMap((key) => {
        if (!(key in bundled)) return [`+ ${key}: published, not bundled`];
        if (!(key in published)) return [`- ${key}: bundled, not published`];
        return isDeepStrictEqual(bundled[key], published[key]) ? [] : [`~ ${key}: changed`];
    });
}

export function renderModule(source, siteConfigs) {
    return [
        `// Generated by tools/sites.mjs. Do not edit: change the sites in Rahti, then run \`make sites-sync\`.`,
        `export const SITES_SOURCE = ${JSON.stringify(source)};`,
        `export const SITE_CONFIGS = ${JSON.stringify(siteConfigs, null, 4)};`,
        ``,
    ].join("\n");
}

const readManifest = () => JSON.parse(readFileSync(join(REPO, MANIFEST), "utf8"));
const writeJson = (file, value) => writeFileSync(join(REPO, file), JSON.stringify(value, null, 2) + "\n");

/** @returns {object|null} `manifest.json` of the last `v*` tag before HEAD, or null without git history or tags. */
export function readReleasedManifest() {
    const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: "pipe" }).trim();
    try {
        const tag = git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD^");
        return JSON.parse(git("show", `${tag}:${MANIFEST}`));
    } catch {
        return null;
    }
}

function releasedOrCommittedManifest() {
    const released = readReleasedManifest();
    if (released) return released;
    console.warn(`No v* tag before HEAD: the committed ${MANIFEST} takes the place of the previous release.`);
    return readManifest();
}

async function main([flag, url]) {
    if (flag === "--check") {
        const { SITE_CONFIGS } = await import(join(REPO, MODULE));
        const patched = patchManifest(readManifest(), SITE_CONFIGS, releasedOrCommittedManifest());
        if (!isDeepStrictEqual(patched, readManifest())) {
            throw new Error(`${MANIFEST}: the site origins do not agree with ${MODULE}. Run \`make sites-sync\`.`);
        }
    } else if (flag === "--check-published" && url) {
        const { SITE_CONFIGS } = await import(join(REPO, MODULE));
        const changes = diffSites(SITE_CONFIGS, await fetchSites(url));
        if (changes.length > 0) {
            throw new Error(`${MODULE} differs from ${url}. Run \`make sites-sync\`.\n  ${changes.join("\n  ")}`);
        }
    } else if (flag && !flag.startsWith("--")) {
        const siteConfigs = await fetchSites(flag);
        mkdirSync(join(REPO, dirname(MODULE)), { recursive: true });
        writeFileSync(join(REPO, MODULE), renderModule(flag, siteConfigs));
        writeJson(MANIFEST, patchManifest(readManifest(), siteConfigs, releasedOrCommittedManifest()));
        console.log(`${MODULE}: ${Object.keys(siteConfigs).length} sites from ${flag}`);
    } else {
        console.error("Usage: node tools/sites.mjs <manifest-url> | --check | --check-published <manifest-url>");
        process.exit(2);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
