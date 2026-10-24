#!/usr/bin/env node
"use strict";

/**
 * @file devserver-paths.mjs
 * The filesystem paths the development-server tools share: the repository root and one e2e data directory per
 * test. The drift target and the e2e harness derive their paths here, not in their callers.
 */

import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve, sep } from "node:path";

/** The root of the Paatti checkout; both the test image and the dev container mount the repo at `/app`, and a
 * plain run uses the checkout path. */
export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** The directory the development-server tools may delete and rewrite: `build/` under the checkout. */
const ownedRoot = resolve(join(repoRoot, "build"));

/**
 * `dir` with its symlinks resolved as far as it exists; the part that does not exist yet is appended to its real
 * parent. A string prefix test alone would let `build/link` — a symlink to `/` — pass as owned.
 *
 * @param {string} dir - An absolute path.
 * @returns {string}
 */
function realPath(dir) {
    const tail = [];
    let current = dir;
    for (;;) {
        try {
            return join(realpathSync(current), ...tail.reverse());
        } catch {
            const parent = dirname(current);
            if (parent === current) return resolve(dir);
            tail.push(basename(current));
            current = parent;
        }
    }
}

/**
 * Throws unless `dir` is strictly inside an allowed root: containment alone is not enough, because a target that
 * *is* the root would wipe everything the repository builds.
 *
 * @param {string} dir - An absolute, resolved directory.
 * @param {string[]} allowedRoots - Absolute directories `dir` must sit below.
 * @param {string} what - Names the argument in the error, for the caller's message.
 */
export function assertOwnedDir(dir, allowedRoots, what) {
    const real = realPath(dir);
    const inside = allowedRoots.some((root) => real.startsWith(realPath(root) + sep));
    if (!inside) {
        throw new Error(`${what} must be inside one of: ${allowedRoots.join(", ")} (got ${dir})`);
    }
}

/**
 * @param {string} testName - A test's unique name, for example "capture" or "drift-<pid>". It must be a plain
 *   directory name: a value with a separator could escape the e2e tree.
 * @returns {string} The (absolute) existing directory that holds the test's server data.
 */
export function e2eDataDir(testName) {
    if (!testName || testName.includes("/") || testName.includes("\\") || testName === "." || testName === "..") {
        throw new Error(`e2eDataDir: not a plain directory name: ${JSON.stringify(testName)}`);
    }
    const dir = join(ownedRoot, "e2e", testName);
    // Out with the last run's files: the server appends to `captures/<host>/links.json` and only writes
    // `sites.json` when absent, so a kept folder would be the previous run's data.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
}
