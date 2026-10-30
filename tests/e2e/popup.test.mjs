/**
 * @file popup.test.mjs
 * The popup's send on sites that the base providers do not list: what it adds, and what lands in the capture
 * folder. The captured-sites provider is the second one the harness adds; the folders in the scenario's data
 * directory are the assertion.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./harness/scenario.mjs";
import { sendPage, statuses, waitUntil } from "./harness/waits.mjs";
import { waitForCaptures } from "./harness/captures.mjs";

describe("the popup's send on a site the providers do not list", () => {
    /** @type {Awaited<ReturnType<typeof scenario>>} */
    let env;

    before(async () => {
        env = await scenario("popup");
        await env.browser.addProvider(`${env.base}/manifest/ilta-pulu/manifest.json`);
        await env.browser.addProvider(`${env.base}/manifest/captured-sites/manifest.json`);
    });

    after(async () => {
        await env?.close();
    });

    test("on 127.0.0.1, the capture lands under its own host, and the page converts after the send", async () => {
        const base = `http://127.0.0.1:${env.server.port}`;
        const site = await env.browser.newPage();
        await site.goto(`${base}/?seed=5`);
        assert.deepEqual(await statuses(site), {}, "Paatti must not run on a site that no provider supplies");

        await sendPage(env.browser, base);

        const { sites } = await waitForCaptures(env.dataDir, "127.0.0.1");
        assert.deepEqual(Object.keys(sites), ["127.0.0.1"]);
        assert.deepEqual(sites["127.0.0.1"].origins, ["http://127.0.0.1/*"]);

        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));
        const badgeCount = await site.locator("[data-klikkikuri-converted-title^='[dev] ']").count();
        assert.ok(badgeCount > 0);
    });

    test("on a site that is off, the sent rules are the site's own, and the page converts after the send", async () => {
        const site = await env.browser.newPage();
        await env.browser.run(async () => {
            const { controller } = await import("/src/controller.js");
            await controller.setSiteEnabled(false, "localhost");
        });
        await site.goto(`${env.base}/?seed=5`);
        assert.deepEqual(await statuses(site), {}, "Paatti must not run on a site that is off");

        await sendPage(env.browser, env.base);

        const sentRules = await env.browser.run(async () => {
            const { getConfig } = await import("/src/config.js");
            return (await getConfig()).siteConfigs.localhost.rules;
        });
        const stored = await waitForCaptures(env.dataDir, "localhost");
        const capturedRules = stored.sites.localhost?.rules;
        assert.ok(capturedRules?.length, "the capture must carry the site rules");
        assert.deepEqual(capturedRules, sentRules);
        assert.ok(Object.keys(stored.links).length > 0);

        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));
    });
});
