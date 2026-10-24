/**
 * @file scenario.mjs
 * One e2e scenario: a karikko on a free port with its own data directory, and a Chromium with the staged
 * extension. Every suite used to repeat this setup; it lives here once.
 */

import { launch } from "./browser.mjs";
import { stagedExtension } from "./extension.mjs";
import { e2eDataDir } from "../../../tools/devserver-paths.mjs";
import { startServer } from "../../../tools/devserver-server.mjs";

const DIST_DIR = process.env.DIST_DIR ?? "/app/build/dist";

/**
 * Starts the server and the browser for one suite. The caller must pass the returned `close` to an
 * unconditional `after` hook; every part tolerates a missing peer, and the staged copy is removed last.
 *
 * @param {string} name - The suite's unique name: its data directory and profile prefix.
 * @param {{flags?: string[], bootstrap?: boolean, manifestUrls?: string[]}} [options] - Server flags, and the
 *   staging options of the extension copy (see `stagedExtension`).
 * @returns {Promise<{server: Awaited<ReturnType<typeof startServer>>, browser: Awaited<ReturnType<typeof launch>>,
 *   dataDir: string, base: string, close: () => Promise<void>}>}
 */
export async function scenario(name, { flags = [], bootstrap = false, manifestUrls = [] } = {}) {
    const dataDir = e2eDataDir(name);
    const server = await startServer({ dataDir, flags });
    const staged = stagedExtension(DIST_DIR, name, { bootstrap, manifestUrls });
    const browser = await launch(staged.extensionDir);
    return {
        server,
        browser,
        dataDir,
        base: `http://localhost:${server.port}`,
        close: async () => {
            // Concurrent: neither depends on the other, and the copy goes only once both have let go of it.
            await Promise.allSettled([browser?.close(), server?.stop()]);
            staged.cleanup();
        },
    };
}
