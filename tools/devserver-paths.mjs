#!/usr/bin/env node
"use strict";

/**
 * @file devserver-paths.mjs
 * The filesystem paths the development-server tools share: the repository root and one e2e data directory per
 * test. The drift target and the e2e harness derive their paths here, not in their callers.
 */

import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** The root of the Paatti checkout; both the test image and the dev container mount the repo at `/app`, and a
 * plain run uses the checkout path. */
export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * @param {string} testName - A test's unique name, for example "capture" or "drift-<pid>".
 * @returns {string} The (absolute) existing directory that holds the test's server data.
 */
export function e2eDataDir(testName) {
    const dir = join(repoRoot, "build", "e2e", testName);
    // Out with the last run's files: the server appends to `captures/<host>/links.json` and only writes
    // `sites.json` when absent, so a kept folder would be the previous run's data.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
}
