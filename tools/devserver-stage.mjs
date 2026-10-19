#!/usr/bin/env node
"use strict";

/**
 * @file devserver-stage.mjs
 * Stages a copy of the extension that adds development server providers on its first install. run.sh runs it.
 *
 * The copy also requires `http://localhost/*`, and its background is `devserver-bootstrap.js`: that module loads
 * `src/background.js`, then does what a person does on the options page (see the module). `devserver.json` gives it
 * the manifest URLs. The source directory does not change.
 *
 * Usage: node tools/devserver-stage.mjs <source-dir> <target-dir> <manifest-url>...
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCALHOST_GRANT = "http://localhost/*";
export const BOOTSTRAP = "devserver-bootstrap.js";
const BOOTSTRAP_SOURCE = join(dirname(fileURLToPath(import.meta.url)), BOOTSTRAP);

/**
 * @param {object} manifest - The `manifest.json` of the source directory.
 * @returns {object} A copy that requires `http://localhost/*` and starts the bootstrap module as its background.
 */
export function stagedManifest(manifest) {
    const copy = structuredClone(manifest);
    copy.host_permissions = [...new Set([...(copy.host_permissions || []), LOCALHOST_GRANT])];
    if (copy.background.service_worker) copy.background.service_worker = BOOTSTRAP;
    if (copy.background.scripts) copy.background.scripts = [BOOTSTRAP];
    return copy;
}

/**
 * Copies `from` to `to` without `skip` and without the entries that a browser does not load from an unpacked
 * extension: dot entries and `node_modules`. `cpSync` refuses a target inside the source, even when a filter skips it.
 */
function copyExtension(from, to, skip) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
        const path = join(from, name);
        if (name.startsWith(".") || name === "node_modules" || resolve(path) === skip) continue;
        if (statSync(path).isDirectory()) copyExtension(path, join(to, name), skip);
        else copyFileSync(path, join(to, name));
    }
}

/**
 * @param {string} source - An unpacked extension.
 * @param {string} target - Removed, then written again.
 * @param {string[]} manifestUrls - The provider manifests that the bootstrap adds, in this order.
 */
export function stage(source, target, manifestUrls) {
    if (manifestUrls.length === 0) throw new Error("no manifest URL");
    manifestUrls.forEach((url) => new URL(url));
    const resolvedTarget = resolve(target);
    rmSync(resolvedTarget, { recursive: true, force: true });
    copyExtension(source, resolvedTarget, resolvedTarget);

    const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
    writeFileSync(join(resolvedTarget, "manifest.json"), JSON.stringify(stagedManifest(manifest), null, 2) + "\n");
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
