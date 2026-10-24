/**
 * @file extension.mjs
 * The extension under test, staged from `DIST_DIR`. The staged copy is the source's own manifest with the
 * loopback grants added. With `{ bootstrap: false }` (the default here) it has no first-install work and the
 * harness adds the providers itself; with the bootstrap it installs like `./run.sh --devserver` does.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stage } from "../../../tools/devserver-stage.mjs";

/**
 * @param {string} distDir - The unpacked extension to copy.
 * @param {string} runId - A unique prefix for the temporary staging directory.
 * @param {{bootstrap?: boolean, manifestUrls?: string[]}} [options] - See `stage`. Default: no bootstrap.
 * @returns {{extensionDir: string, cleanup: () => void}} The directory to load, and the call that removes the
 *   temporary copy. The caller owns both: the copy must outlive the browser that loaded it.
 */
export function stagedExtension(distDir, runId, { bootstrap = false, manifestUrls = [] } = {}) {
    const root = mkdtempSync(join(tmpdir(), `paatti-e2e-${runId}-`));
    const extensionDir = join(root, "paatti");
    stage(distDir, extensionDir, manifestUrls, { bootstrap });
    return { extensionDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
