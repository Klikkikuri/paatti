/**
 * @file popup.test.mjs
 * The popup's send on sites that the base providers do not list: what it adds, and what lands in the capture
 * folder. Ports the 127.0.0.1 case and the site-off case of the pre-split Python suite (the deleted devserver/ tree; its history lives in Klikkikuri/karikko); the
 * captured-sites provider becomes the second one the harness adds, and the folders are the assertion.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./harness/browser.mjs";
import { stagedExtensionDir } from "./harness/extension.mjs";
import { e2eDataDir } from "../../tools/devserver-paths.mjs";
import { freePort, startServer } from "../../tools/devserver-server.mjs";
import { sendPage, statuses, waitUntil } from "./harness/waits.mjs";
import { waitForCaptures } from "./harness/captures.mjs";

const DIST_DIR = process.env.DIST_DIR ?? "/app/build/dist";

describe("the popup's send on a site the providers do not list", () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    const dataDir = e2eDataDir("popup");
    /** @type {Awaited<ReturnType<typeof launch>>} */
    let browser;

    before(async () => {
        server = await startServer({ dataDir, port: await freePort() });
        browser = await launch(stagedExtensionDir(DIST_DIR, "popup"));
        await browser.addProvider(`http://localhost:${server.port}/manifest/ilta-pulu/manifest.json`);
        await browser.addProvider(`http://localhost:${server.port}/manifest/captured-sites/manifest.json`);
    });

    after(async () => {
        await browser?.close();
        await server?.stop();
    });

    test("on 127.0.0.1, the capture lands under its own host, and the page converts after the send", async () => {
        const base = `http://127.0.0.1:${server.port}`;
        const site = await browser.newPage();
        await site.goto(`${base}/?seed=5`);
        assert.deepEqual(await statuses(site), {}, "Paatti must not run on a site that no provider supplies");

        const status = await sendPage(browser, base);
        assert.match(status, /^Done/);

        const { sites } = await waitForCaptures(dataDir, "127.0.0.1");
        assert.deepEqual(Object.keys(sites), ["127.0.0.1"]);
        assert.deepEqual(sites["127.0.0.1"].origins, ["http://127.0.0.1/*"]);

        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));
        const badgeCount = await site.locator("[data-klikkikuri-converted-title^='[dev] ']").count();
        assert.ok(badgeCount > 0);
    });

    test("on a site that is off, the sent rules are the site's own, and the page converts after the send", async () => {
        const base = `http://localhost:${server.port}`;
        const site = await browser.newPage();
        await browser.run(async () => {
            const { controller } = await import("/src/controller.js");
            await controller.setSiteEnabled(false, "localhost");
        });
        await site.goto(`${base}/?seed=5`);
        assert.deepEqual(await statuses(site), {}, "Paatti must not run on a site that is off");

        const status = await sendPage(browser, base);
        assert.match(status, /^Done/);

        const sentRules = await browser.run(async () => {
            const { getConfig } = await import("/src/config.js");
            return (await getConfig()).siteConfigs.localhost.rules;
        });
        const stored = await waitForCaptures(dataDir, "localhost");
        const capturedRules = stored.sites.localhost?.rules;
        assert.ok(capturedRules?.length, "the capture must carry the site rules");
        assert.deepEqual(capturedRules, sentRules);
        assert.ok(Object.keys(stored.links).length > 0);

        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));
    });
});
