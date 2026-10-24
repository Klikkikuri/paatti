/**
 * @file bootstrap.test.mjs
 * The first-install flow of a staged copy: the background swap to devserver-bootstrap.js must add and refresh the
 * providers of `devserver.json` on its own, with no harness call in between. This is what `./run.sh --devserver`
 * does; every other suite stages with `{ bootstrap: false }` and adds the providers itself.
 *
 * The server starts before the extension loads, because the manifest URLs written into `devserver.json` carry its
 * port — so this suite composes startServer and launch directly instead of using scenario().
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./harness/browser.mjs";
import { stagedExtensionDir } from "./harness/extension.mjs";
import { e2eDataDir } from "../../tools/devserver-paths.mjs";
import { startServer } from "../../tools/devserver-server.mjs";
import { statuses, waitUntil } from "./harness/waits.mjs";

const DIST_DIR = process.env.DIST_DIR ?? "/app/build/dist";

describe("the first install of a staged copy", () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    /** @type {Awaited<ReturnType<typeof launch>>} */
    let browser;

    before(async () => {
        server = await startServer({ dataDir: e2eDataDir("bootstrap") });
        const base = `http://localhost:${server.port}`;
        browser = await launch(stagedExtensionDir(DIST_DIR, "bootstrap", {
            bootstrap: true,
            manifestUrls: [`${base}/manifest/ilta-pulu/manifest.json`, `${base}/manifest/captured-sites/manifest.json`],
        }));
    });

    after(async () => {
        await browser?.close();
        await server?.stop();
    });

    test("the bootstrap adds the providers and turns on their site", async () => {
        const iltaPulu = `http://localhost:${server.port}/manifest/ilta-pulu/manifest.json`;
        // The install listener runs in the worker; give its provider round trips a deadline rather than a sleep.
        const data = await waitUntil(async () => {
            const read = await browser.providerData(iltaPulu);
            return read?.entryCount > 0 ? read : null;
        }, 60000);
        assert.deepEqual(data.errors, [], JSON.stringify(data));
        assert.ok(data.sites.includes("localhost"), JSON.stringify(data.sites));

        const config = await browser.run(async () => {
            const { getConfig } = await import("/src/config.js");
            return await getConfig();
        });
        assert.equal(config.activeEnv, "development", "the install must keep the development environment");
        assert.equal(config.loopbackProvidersEnabled, true, "the bootstrap turns on loopback providers");

        const page = await browser.newPage();
        await page.goto(`http://localhost:${server.port}/?seed=5`);
        assert.ok(await waitUntil(async () => (await statuses(page)).converted),
            "a bootstrapped install converts the page without any manual step");
    });
});
