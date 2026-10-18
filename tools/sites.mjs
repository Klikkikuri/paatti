#!/usr/bin/env node
"use strict";

/**
 * @file sites.mjs
 * Records the default sites from a provider manifest, and writes the manifest origins they need.
 *
 * The default sites are the sites of the default provider: Rahti's `sites.json`, linked from its provider manifest.
 * The extension downloads them at runtime, like the sites of any other provider, and does not read the record. A
 * store build can request only the origins that `manifest.json` declares, so this script writes them there. It
 * resolves the manifest with `src/provider.js`, so the sites pass the same validation as at runtime, and writes the
 * record to `src/generated/sites.js`. The record is committed, so that the checks run offline and a Paatti commit
 * always names the same sites.
 *
 * The module records the Rahti commit it comes from, so that a check against Rahti gives the same result for a
 * given Paatti commit. A sync keeps the recorded commit while the sites stay the same, because Rahti `main` moves
 * many times each hour. A `site-configs` href must resolve under the directory of the manifest, so that the pinned
 * URL pins the sites too. This is stricter than the runtime resolver. A loopback sync records no commit, and the
 * checks refuse it.
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
 *   node tools/sites.mjs --check <manifest-url>           offline: fail if the module is not pinned to the manifest,
 *                                                         or if manifest.json does not agree with the module
 *   node tools/sites.mjs --check-published <manifest-url> fail if the module differs from its pinned Rahti commit,
 *                                                         or if that commit is not on the branch
 *   node tools/sites.mjs --check-latest <manifest-url>    fail if the module differs from the branch now
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
const RAW_HOST = "raw.githubusercontent.com";
const COMMIT = /^[0-9a-f]{40}$/;

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

    const resources = manifest.resources.filter((resource) => resource.type === "site-configs");
    const directory = new URL(".", url).href;
    const inside = (href) => {
        try {
            return new URL(href, url).href.startsWith(directory);
        } catch {
            return false;
        }
    };
    const outside = resources.flatMap((resource) => resource.href).filter((href) => !inside(href));
    if (outside.length > 0) throw new Error(`${url}: site-configs outside ${directory}: ${outside.join(", ")}`);

    const result = await resolve({ ...manifest, resources }, url, options);
    const problems = [
        ...result.errors.filter((e) => e.type === "site-configs").map((e) => e.message),
        ...result.rejected.map((r) => JSON.stringify(r)),
    ];
    if (problems.length > 0) throw new Error(`${url}: site configurations refused:\n  ${problems.join("\n  ")}`);
    if (Object.keys(result.siteConfigs).length === 0) throw new Error(`${url}: no site configurations`);

    return result.siteConfigs;
}

/**
 * The parts of a raw GitHub URL on a branch.
 *
 * A branch name that contains `/` cannot be told from the path. Then `resolveCommit` fails, because git refuses
 * a branch `a` next to a branch `a/b`.
 *
 * @param {string} url
 * @returns {{owner: string, repo: string, branch: string, path: string}|null} null for a URL on another host.
 */
export function parseRawGithubUrl(url) {
    const parsed = new URL(url);
    if (parsed.hostname !== RAW_HOST) return null;

    const match = /^\/([^/]+)\/([^/]+)\/refs\/heads\/([^/]+)\/(.+)$/.exec(parsed.pathname);
    const plain = parsed.protocol === "https:" && !parsed.port && !parsed.username && !parsed.password
        && !parsed.search && !parsed.hash;
    if (!match || !plain) throw new Error(`${url}: not https://${RAW_HOST}/<owner>/<repo>/refs/heads/<branch>/<path>`);

    const [, owner, repo, branch, path] = match;
    return { owner, repo, branch, path };
}

/** @returns {string} `source` with `commit` in place of its branch. */
export function pinnedManifestUrl(source, commit) {
    const { owner, repo, path } = parseRawGithubUrl(source);
    return `https://${RAW_HOST}/${owner}/${repo}/${commit}/${path}`;
}

function gitLsRemote(repository, ref) {
    const args = ["-c", "core.sshCommand=ssh -oBatchMode=yes", "ls-remote", "--heads", "--exit-code", repository, ref];
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    return execFileSync("git", args, { encoding: "utf8", stdio: "pipe", timeout: 30_000, env });
}

/**
 * The commit at the head of the branch of a raw GitHub URL.
 *
 * @param {string} source
 * @param {(repository: string, ref: string) => string} [lsRemote] - The output of `git ls-remote`.
 * @returns {string|null} null for a URL on another host. Every failure for a GitHub URL throws.
 */
export function resolveCommit(source, lsRemote = gitLsRemote) {
    const parsed = parseRawGithubUrl(source);
    if (!parsed) return null;

    const ref = `refs/heads/${parsed.branch}`;
    const lines = lsRemote(`https://github.com/${parsed.owner}/${parsed.repo}`, ref).trim().split("\n");
    const [commit, name] = lines[0].split("\t");
    if (lines.length !== 1 || name !== ref || !COMMIT.test(commit)) {
        throw new Error(`${source}: cannot resolve ${ref}:\n  ${lines.join("\n  ")}`);
    }
    return commit;
}

/**
 * Whether `commit` is in the history of the branch of `source`.
 *
 * raw.githubusercontent.com also serves the commits of a fork under the path of its parent, so the commit that a
 * module records is not trusted.
 *
 * @param {string} source
 * @param {string} commit
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>} false also when GitHub does not know the commit, the repository or the branch.
 */
export async function isOnBranch(source, commit, fetchImpl = fetch) {
    const { owner, repo, branch } = parseRawGithubUrl(source);
    const token = process.env.GITHUB_TOKEN;
    const headers = { accept: "application/vnd.github+json", ...(token && { authorization: `Bearer ${token}` }) };
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/compare/${commit}...${branch}`, { headers });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub compare ${commit}...${branch}: HTTP ${response.status}`);

    const { status } = await response.json();
    return status === "ahead" || status === "identical";
}

/**
 * The commit a sync keeps: the committed one, while it comes from the same source and the sites did not change.
 *
 * @param {object|null} committed - The exports of the committed module, or null.
 * @param {string} source
 * @param {object} siteConfigs - The sites at the head of the branch.
 * @returns {string|null}
 */
export function keepCandidate(committed, source, siteConfigs) {
    if (!committed || committed.SITES_SOURCE !== source || !COMMIT.test(committed.SITES_COMMIT)) return null;
    return diffSites(committed.SITE_CONFIGS, siteConfigs).length === 0 ? committed.SITES_COMMIT : null;
}

/**
 * The sites at the head of the branch. The commit is resolved first, because the branch URL is cached and moves.
 *
 * @returns {Promise<{commit: string|null, siteConfigs: object}>}
 */
async function fetchLatest(source) {
    const commit = resolveCommit(source);
    return { commit, siteConfigs: await fetchSites(commit ? pinnedManifestUrl(source, commit) : source) };
}

const diffAt = async (source, commit, siteConfigs) => diffSites(siteConfigs, await fetchSites(pinnedManifestUrl(source, commit)));

/**
 * Whether a sync can keep `commit`: it is on the branch, and this `src/provider.js` resolves its sites to
 * `siteConfigs`. A failure gives false, so the sync writes the head of the branch.
 */
async function canKeep(source, commit, siteConfigs) {
    try {
        return await isOnBranch(source, commit) && (await diffAt(source, commit, siteConfigs)).length === 0;
    } catch {
        return false;
    }
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
 * @param {object} recorded
 * @param {object} published
 * @returns {string[]} One line for each site that is added, removed or changed.
 */
export function diffSites(recorded, published) {
    const keys = new Set([...Object.keys(recorded), ...Object.keys(published)]);
    return [...keys].flatMap((key) => {
        if (!(key in recorded)) return [`+ ${key}: published, not recorded`];
        if (!(key in published)) return [`- ${key}: recorded, not published`];
        return isDeepStrictEqual(recorded[key], published[key]) ? [] : [`~ ${key}: changed`];
    });
}

export function renderModule(source, siteConfigs, commit) {
    return [
        `// Generated by tools/sites.mjs. Do not edit: change the sites in Rahti, then run \`make sites-sync\`.`,
        `export const SITES_SOURCE = ${JSON.stringify(source)};`,
        `export const SITES_COMMIT = ${JSON.stringify(commit)};`,
        `export const SITE_CONFIGS = ${JSON.stringify(siteConfigs, null, 4)};`,
        ``,
    ].join("\n");
}

const importModule = () => import(join(REPO, MODULE));
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
    // In CI the checkout has its history, so a missing tag is a shallow checkout, not a source archive.
    if (process.env.GITHUB_ACTIONS && existsSync(join(REPO, ".git"))) {
        throw new Error("No v* tag before HEAD, or git cannot read it. Check out the full history with its tags.");
    }
    console.warn(`No v* tag before HEAD: the committed ${MANIFEST} takes the place of the previous release.`);
    return readManifest();
}

function requirePinned({ SITES_SOURCE, SITES_COMMIT }, source) {
    if (SITES_SOURCE !== source) throw new Error(`${MODULE} comes from ${SITES_SOURCE}, not ${source}. Run \`make sites-sync\`.`);
    if (!COMMIT.test(SITES_COMMIT)) throw new Error(`${MODULE} records no Rahti commit. Run \`make sites-sync\`.`);
}

async function sync(source) {
    const latest = await fetchLatest(source);
    // A missing or broken module is no candidate: the sync is what repairs it.
    const kept = keepCandidate(await importModule().catch(() => null), source, latest.siteConfigs);
    const commit = kept && await canKeep(source, kept, latest.siteConfigs) ? kept : latest.commit;

    mkdirSync(join(REPO, dirname(MODULE)), { recursive: true });
    writeFileSync(join(REPO, MODULE), renderModule(source, latest.siteConfigs, commit));
    writeJson(MANIFEST, patchManifest(readManifest(), latest.siteConfigs, releasedOrCommittedManifest()));
    console.log(`${MODULE}: ${Object.keys(latest.siteConfigs).length} sites from ${source} at ${commit ?? "no commit"}`);
}

async function check(source) {
    const { SITE_CONFIGS, ...pin } = await importModule();
    requirePinned(pin, source);
    const patched = patchManifest(readManifest(), SITE_CONFIGS, releasedOrCommittedManifest());
    if (!isDeepStrictEqual(patched, readManifest())) {
        throw new Error(`${MANIFEST}: the site origins do not agree with ${MODULE}. Run \`make sites-sync\`.`);
    }
}

async function checkPublished(source) {
    const { SITE_CONFIGS, ...pin } = await importModule();
    requirePinned(pin, source);
    if (!await isOnBranch(source, pin.SITES_COMMIT)) {
        throw new Error(`Rahti commit ${pin.SITES_COMMIT} is not on the branch of ${source}, or GitHub does not know `
            + `the repository or the branch. Run \`make sites-sync\`.`);
    }
    const changes = await diffAt(source, pin.SITES_COMMIT, SITE_CONFIGS);
    if (changes.length > 0) {
        throw new Error(`${MODULE} differs from Rahti commit ${pin.SITES_COMMIT}. Run \`make sites-sync\`.\n  ${changes.join("\n  ")}`);
    }
}

async function checkLatest(source) {
    const { SITE_CONFIGS, SITES_COMMIT } = await importModule();
    const latest = await fetchLatest(source);
    const changes = diffSites(SITE_CONFIGS, latest.siteConfigs);
    if (changes.length > 0) {
        throw new Error(`The recorded default sites (Rahti ${SITES_COMMIT}) differ from ${source} (Rahti ${latest.commit}). `
            + `Run \`make sites-sync\`.\n  ${changes.join("\n  ")}`);
    }
}

const COMMANDS = { "--check": check, "--check-published": checkPublished, "--check-latest": checkLatest };

async function main([flag, url]) {
    if (Object.hasOwn(COMMANDS, flag) && url) return COMMANDS[flag](url);
    if (flag && !flag.startsWith("--")) return sync(flag);

    console.error("Usage: node tools/sites.mjs <manifest-url> | --check | --check-published | --check-latest <manifest-url>");
    process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
