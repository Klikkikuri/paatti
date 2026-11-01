#!/usr/bin/env node
"use strict";

/**
 * @file devserver-stage.mjs
 * Stages a copy of the extension that adds development server providers on its first install. run.sh runs it;
 * the e2e stages the same copy without the bootstrap, and drives the options page itself. The full flow story is
 * in README.md ("Development server"); this header keeps only what a reader of the code needs.
 *
 * The copy also requires the loopback grants (`http://localhost/*` and `http://127.0.0.1/*`), and its background is
 * `devserver-bootstrap.js`: that module loads `src/background.js`, then does what a person does on the options page
 * (see the module). `devserver.json` gives it the manifest URLs. The source directory does not change.
 *
 * Usage: node tools/devserver-stage.mjs <source-dir> <target-dir> <manifest-url>...
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { assertOwnedDir, repoRoot } from "./devserver-paths.mjs";

/** The loopback origins a development copy requires. The `127.0.0.1` one serves the popup capture test. */
export const LOOPBACK_GRANTS = ["http://localhost/*", "http://127.0.0.1/*"];
export const BOOTSTRAP = "devserver-bootstrap.js";
const BOOTSTRAP_SOURCE = join(dirname(fileURLToPath(import.meta.url)), BOOTSTRAP);

/** The roots a staged target may sit inside: the repository's build tree, and the OS temporary root for tests. */
const ALLOWED_TARGET_ROOTS = [resolve(join(repoRoot, "build")), resolve(tmpdir())];

/**
 * @typedef {object} StageOptions
 * @property {boolean} [bootstrap] - Swap the background to `devserver-bootstrap.js` and write `devserver.json`.
 *   True by default (the run.sh flow); the e2e passes false and names the providers itself.
 */

/**
 * @param {object} manifest - The `manifest.json` of the source directory.
 * @param {boolean} [bootstrap] - See {@link StageOptions}.
 * @returns {object} A copy that requires the loopback grants and, with `bootstrap`, starts the bootstrap module
 *   as its background.
 */
export function stagedManifest(manifest, bootstrap = true) {
    const copy = structuredClone(manifest);
    copy.host_permissions = [...new Set([...(copy.host_permissions || []), ...LOOPBACK_GRANTS])];
    if (!bootstrap) return copy;
    if (!copy.background) throw new Error("the manifest has no background section to swap");
    if (copy.background.service_worker) copy.background.service_worker = BOOTSTRAP;
    if (copy.background.scripts) copy.background.scripts = [BOOTSTRAP];
    return copy;
}

/** Whether a directory entry is something a browser does not load from an unpacked extension, or the target
 * itself: dot entries, installed dependencies, and the tree being written inside the source. */
function skipEntry(name, path, skip) {
    return name.startsWith(".") || name === "node_modules" || resolve(path) === skip;
}

/**
 * Copies `from` to `to` without `skip` and without the entries {@link skipEntry} rejects. `cpSync` refuses a
 * target inside the source, even when a filter skips it.
 */
function copyExtension(from, to, skip) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
        const path = join(from, name);
        if (skipEntry(name, path, skip)) continue;
        if (statSync(path).isDirectory()) copyExtension(path, join(to, name), skip);
        else copyFileSync(path, join(to, name));
    }
}

/**
 * @param {string} source - An unpacked extension.
 * @param {string} target - Removed, then written again. Must sit inside `build/` or the OS temporary root, so a
 *   wrong argument cannot delete what the tool does not own.
 * @param {string[]} [manifestUrls] - The provider manifests that the bootstrap adds, in this order. Required with
 *   the default `bootstrap`; ignored without it.
 * @param {StageOptions} [options]
 */
export function stage(source, target, manifestUrls = [], { bootstrap = true } = {}) {
    if (bootstrap && manifestUrls.length === 0) throw new Error("no manifest URL");
    manifestUrls.forEach((url) => new URL(url));
    const resolvedSource = resolve(source);
    const resolvedTarget = resolve(target);
    if (resolvedSource === resolvedTarget) throw new Error("the target must not be the source itself");
    assertOwnedDir(resolvedTarget, ALLOWED_TARGET_ROOTS, "stage target");
    rmSync(resolvedTarget, { recursive: true, force: true });
    copyExtension(source, resolvedTarget, resolvedTarget);

    const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
    writeFileSync(join(resolvedTarget, "manifest.json"), JSON.stringify(stagedManifest(manifest, bootstrap), null, 2) + "\n");
    if (!bootstrap) return;
    copyFileSync(BOOTSTRAP_SOURCE, join(resolvedTarget, BOOTSTRAP));
    writeFileSync(join(resolvedTarget, "devserver.json"), JSON.stringify({ manifestUrls }) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [source, target, ...manifestUrls] = process.argv.slice(2);
    if (manifestUrls.length === 0) {
        console.error("Usage: node tools/devserver-stage.mjs <source-dir> <target-dir> <manifest-url>...");
        process.exit(2);
    }
    try {
        stage(source, target, manifestUrls);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
