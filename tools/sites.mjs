#!/usr/bin/env node
"use strict";

/**
 * @file sites.mjs
 * Writes the origins of the default sites into `manifest.json`, and pins the Rahti commit they come from.
 *
 * The default sites are the sites of the default provider: Rahti's `sites.json`, linked from its provider manifest.
 * The extension downloads them at runtime, like the sites of any other provider. A store build can request only the
 * origins that `manifest.json` declares, so this script writes them there. It resolves the manifest with
 * `src/provider.js`, so the sites pass the same validation as at runtime.
 *
 * `sites.lock.json` is committed, so that the checks run offline and a Paatti commit always gives the same result.
 * It holds:
 * - `source`: the provider manifest URL, so that a check refuses a lock made from another URL.
 * - `commit`: the Rahti commit, because Rahti `main` moves many times each hour. A sync keeps it while the origins
 *   stay the same. A `site-configs` href must resolve under the directory of the manifest, so that the pinned URL
 *   pins the sites too. This is stricter than the runtime resolver. A loopback sync records no commit, and the
 *   checks refuse it.
 * - `origins`: the `enabled` and `disabled` site origins, sorted. `manifest.json` cannot tell an enabled origin that
 *   stays optional (see below) from a disabled one.
 * Only origins and `enabled` are compared: a change to the rules of a site does not change `manifest.json`.
 *
 * In `manifest.json`, an enabled origin goes into `host_permissions`, a disabled one into
 * `optional_host_permissions`, and every origin into the `matches` of the named `web_accessible_resources` group.
 * An entry of the form `https://<host>/*` belongs to this script; every other entry is kept, first.
 *
 * An origin that is optional in the previous release stays optional, also when its site becomes enabled. A new
 * required host permission makes Chrome disable the extension at update until the user accepts it. The previous
 * release is the last `v*` tag before HEAD, so that `--check` gives the same result on the tagged commit. Without
 * git history or tags, the committed `manifest.json` takes the place of the previous release.
 *
 * Usage:
 *   node tools/sites.mjs <manifest-url>                   write sites.lock.json and the manifest origins
 *   node tools/sites.mjs --check <manifest-url>           offline: fail if the lock is not pinned to the manifest URL,
 *                                                         or if manifest.json does not agree with the lock
 *   node tools/sites.mjs --check-published <manifest-url> fail if the origins at the pinned commit differ from the
 *                                                         lock, or if that commit is not on the branch
 *   node tools/sites.mjs --check-latest <manifest-url>    fail if the origins on the branch now differ from the lock
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";

import { fetchManifest, resolve } from "../src/provider.js";
import { ARBITRARY_ORIGINS } from "../src/options/origins.js";

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = "sites.lock.json";
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

const sorted = (list) => [...new Set(list)].sort();

/**
 * @param {object} siteConfigs - Resolved sites, keyed by host.
 * @returns {{enabled: string[], disabled: string[]}} Sorted, without duplicates. An origin that an enabled site has
 *   is not in `disabled`.
 */
export function originsOf(siteConfigs) {
    const sites = Object.values(siteConfigs);
    const enabled = sorted(sites.filter((site) => site.enabled).flatMap((site) => site.origins));
    const disabled = sorted(sites.filter((site) => !site.enabled).flatMap((site) => site.origins))
        .filter((origin) => !enabled.includes(origin));
    return { enabled, disabled };
}

/**
 * @param {{enabled: string[], disabled: string[]}} expected
 * @param {{enabled: string[], disabled: string[]}} actual
 * @returns {string[]} One line for each origin that `actual` adds or removes.
 */
export function diffOrigins(expected, actual) {
    return ["enabled", "disabled"].flatMap((state) => [
        ...actual[state].filter((origin) => !expected[state].includes(origin)).map((origin) => `+ ${state} ${origin}`),
        ...expected[state].filter((origin) => !actual[state].includes(origin)).map((origin) => `- ${state} ${origin}`),
    ]);
}

/**
 * The commit a sync can keep: the lock's, while it comes from the same source and the origins did not change.
 *
 * @param {object|null} lock - The parsed `sites.lock.json`, or null.
 * @param {string} source
 * @param {{enabled: string[], disabled: string[]}} headOrigins - The origins at the head of the branch.
 * @returns {string|null}
 */
export function keepCandidate(lock, source, headOrigins) {
    if (!lock || lock.source !== source || !COMMIT.test(lock.commit)) return null;
    return isDeepStrictEqual(lock.origins, headOrigins) ? lock.commit : null;
}

/** @throws if the lock does not come from `source`. */
export function requireSource(lock, source) {
    if (!lock) throw new Error(`${LOCK} is missing or not JSON. Run \`make sites-sync\`.`);
    if (lock.source !== source) throw new Error(`${LOCK} comes from ${lock.source}, not ${source}. Run \`make sites-sync\`.`);
}

/** @throws if the lock does not come from `source`, records no commit, or its origins are not well formed. */
export function requirePinned(lock, source) {
    requireSource(lock, source);
    if (!COMMIT.test(lock.commit)) throw new Error(`${LOCK} records no Rahti commit. Run \`make sites-sync\`.`);

    const { enabled, disabled } = lock.origins ?? {};
    const wellFormed = (list) => Array.isArray(list) && list.every((origin) => typeof origin === "string"
        && SITE_ORIGIN.test(origin)) && isDeepStrictEqual(list, sorted(list));
    if (!wellFormed(enabled) || !wellFormed(disabled) || enabled.length === 0
        || enabled.some((origin) => disabled.includes(origin))) {
        throw new Error(`${LOCK}: origins.enabled and origins.disabled must be sorted lists of site origins, without `
            + `duplicates, disjoint, and enabled must not be empty. Run \`make sites-sync\`.`);
    }
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

const originsAt = async (source, commit) => originsOf(await fetchSites(pinnedManifestUrl(source, commit)));

/**
 * Whether a sync can keep `commit`: it is on the branch, and this `src/provider.js` resolves its sites to
 * `headOrigins`. A failure gives false, so the sync writes the head of the branch.
 */
async function canKeep(source, commit, headOrigins) {
    try {
        return await isOnBranch(source, commit) && isDeepStrictEqual(await originsAt(source, commit), headOrigins);
    } catch {
        return false;
    }
}

/**
 * @param {object} manifest - `manifest.json`.
 * @param {{enabled: string[], disabled: string[]}} origins
 * @param {object} released - `manifest.json` of the previous release.
 * @returns {object} A copy whose site origins are `origins`.
 */
export function patchManifest(manifest, origins, released) {
    const shippedOptional = new Set(released.optional_host_permissions);
    const enabled = sorted(origins.enabled);
    const disabled = sorted(origins.disabled);
    const required = enabled.filter((origin) => !shippedOptional.has(origin));
    const optional = sorted([...enabled.filter((origin) => shippedOptional.has(origin)), ...disabled]);
    const keep = (list = []) => list.filter((origin) => !SITE_ORIGIN.test(origin));

    const copy = structuredClone(manifest);
    copy.host_permissions = [...keep(manifest.host_permissions), ...required];
    copy.optional_host_permissions = [...keep(manifest.optional_host_permissions), ...optional];
    const named = copy.web_accessible_resources.find((group) => !group.matches.includes(ARBITRARY_ORIGINS));
    named.matches = sorted([...enabled, ...disabled]);

    return copy;
}

/** @returns {string} `value` as the JSON text of a committed file. */
export const renderJson = (value) => JSON.stringify(value, null, 2) + "\n";

/** @returns {object|null} The parsed `sites.lock.json`, or null when it is missing or not JSON. */
export function readLock() {
    try {
        return JSON.parse(readFileSync(join(REPO, LOCK), "utf8"));
    } catch {
        return null;
    }
}

const readManifest = () => JSON.parse(readFileSync(join(REPO, MANIFEST), "utf8"));
const writeJson = (file, value) => writeFileSync(join(REPO, file), renderJson(value));

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

async function sync(source) {
    const latest = await fetchLatest(source);
    const origins = originsOf(latest.siteConfigs);
    const kept = keepCandidate(readLock(), source, origins);
    const commit = kept && await canKeep(source, kept, origins) ? kept : latest.commit;

    writeJson(LOCK, { source, commit, origins });
    writeJson(MANIFEST, patchManifest(readManifest(), origins, releasedOrCommittedManifest()));
    console.log(`${LOCK}: ${Object.keys(latest.siteConfigs).length} sites from ${source} at ${commit ?? "no commit"}`);
}

async function check(source) {
    const lock = readLock();
    requirePinned(lock, source);
    const patched = patchManifest(readManifest(), lock.origins, releasedOrCommittedManifest());
    if (!isDeepStrictEqual(patched, readManifest())) {
        throw new Error(`${MANIFEST}: the site origins do not agree with ${LOCK}. Run \`make sites-sync\`.`);
    }
}

async function checkPublished(source) {
    const lock = readLock();
    requirePinned(lock, source);
    if (!await isOnBranch(source, lock.commit)) {
        throw new Error(`Rahti commit ${lock.commit} is not on the branch of ${source}, or GitHub does not know `
            + `the repository or the branch. Run \`make sites-sync\`.`);
    }
    const changes = diffOrigins(lock.origins, await originsAt(source, lock.commit));
    if (changes.length > 0) {
        throw new Error(`${LOCK} differs from Rahti commit ${lock.commit}. Run \`make sites-sync\`.\n  ${changes.join("\n  ")}`);
    }
}

async function checkLatest(source) {
    const lock = readLock();
    requireSource(lock, source);
    const latest = await fetchLatest(source);
    const changes = diffOrigins(lock.origins, originsOf(latest.siteConfigs));
    if (changes.length > 0) {
        throw new Error(`The origins in ${LOCK} (Rahti ${lock.commit}) differ from ${source} (Rahti ${latest.commit}). `
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
