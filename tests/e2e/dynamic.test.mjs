/**
 * @file dynamic.test.mjs
 * Content that arrives after the first conversion pass, page faults, and the popup's main-page entry. The server's
 * chaos settings are spawn-time flags: each case restarts karikko on the same port with its own flags, and a
 * `beforeEach` returns the server to the base flags first, so no case depends on the one before it.
 */

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./harness/scenario.mjs";
import { gotoProcessed, statuses, waitForMismatches, waitUntil } from "./harness/waits.mjs";
import { convertedArticle, firstSeedWith } from "./harness/articles.mjs";

const BADGES = "klikkikuri-converted-badge, klikkikuri-ai-badge, klikkikuri-video-badge";

describe("content that arrives after the first conversion pass", () => {
    /** @type {Awaited<ReturnType<typeof scenario>>} */
    let env;

    before(async () => {
        env = await scenario("dynamic");
        await env.browser.addProvider(`${env.base}/manifest/ilta-pulu/manifest.json`);
    });

    after(async () => {
        await env?.close();
    });

    // Every case starts from the base flags: chaos is a spawn-time setting, and a restart keeps the last flags.
    beforeEach(async () => {
        await env.server.restart([]);
    });

    /** Opens a checked page and expects its self-check mismatches to settle at none.
     * @param {string} base
     * @param {number} seed
     */
    async function openChecked(base, seed) {
        const page = await env.browser.newPage();
        await gotoProcessed(page, `${base}/?seed=${seed}&check=1`);
        assert.deepEqual(await waitForMismatches(page), []);
        return page;
    }

    test("load-more and ticker replacements are converted", async () => {
        const page = await openChecked(env.base, 7);
        await page.click("#load-more");
        assert.ok(await waitUntil(async () => (await page.locator("[data-devserver-source^='more:']").count()) > 0));
        assert.ok(await waitUntil(async () => (await page.locator("[data-devserver-source^='ticker:']").count()) > 0, 12000));
        assert.deepEqual(await waitForMismatches(page), []);
    });

    test("late content is converted", async () => {
        await env.server.restart(["--chaos.page_late_content=true"]);
        const seed = await firstSeedWith(env.base, "<template data-devserver-late");
        assert.ok(seed !== null, "no seed produces late content");
        const page = await openChecked(env.base, seed);
        const late = page.locator("[data-devserver-chaos='page_late_content']");
        assert.ok(await waitUntil(async () => (await late.count()) > 0));
        assert.deepEqual(await waitForMismatches(page), []);
    });

    test("churned cards get their own status", async () => {
        await env.server.restart(["--chaos.page_dom_churn=true"]);
        const page = await openChecked(env.base, 13);
        const churned = page.locator("[data-devserver-chaos^='page_dom_churn']");
        assert.ok(await waitUntil(async () => (await churned.count()) >= 2, 15000));
        assert.deepEqual(await waitForMismatches(page), []);
    });

    test("an article page is the main page entry", async () => {
        // Runs with the base flags: the beforeEach above restarts the server before every case.
        const article = await convertedArticle(env.browser, env.base);
        assert.ok(article, "the front page must contain a converted article");
        const page = await env.browser.newPage();
        await page.goto(`${env.base}${article.href}`);
        assert.ok(await waitUntil(async () => (await statuses(page)).converted));

        const url = `${env.base}${article.href}`;
        const [main] = await env.browser.run(async (tabUrl) => {
            const { default: browserApi } = await import("/src/browser-api.js");
            const [tab] = await browserApi.tabs.query({ url: tabUrl });
            return browserApi.tabs.sendMessage(tab.id, { command: "getConversions" });
        }, url);
        assert.ok(main?.isMainPage, JSON.stringify(main));
        assert.equal(main.convertedTitle, article.convertedTitle,
            "the article's converted title must be the rahti entry, as the front page showed it");
    });

    describe("badges under hostile css", () => {
        // A nested beforeEach, not a before: the outer beforeEach restarts to the base flags, and node:test runs
        // every before hook ahead of any beforeEach, so a nested before would be undone by it.
        beforeEach(async () => {
            await env.server.restart(["--chaos.page_hostile_css=true"]);
        });

        test("badges keep their size", async () => {
            const page = await openChecked(env.base, 17);
            const badges = page.locator(BADGES);
            assert.ok((await badges.count()) > 0);
            const sizeless = [];
            for (let i = 0; i < await badges.count(); i++) {
                const box = await badges.nth(i).boundingBox();
                if (!box?.width) sizeless.push(i);
            }
            assert.deepEqual(sizeless, [], `${sizeless.length} of ${await badges.count()} badges have no size`);
        });

        // `todo` keeps the body running and reports an unexpected pass — the strict xfail this suite ports.
        test("badges stay visible -- known extension gap",
            { todo: "known extension gap: the badges force display, not visibility" }, async () => {
                const page = await openChecked(env.base, 17);
                const badges = page.locator(BADGES);
                const hidden = [];
                for (let i = 0; i < await badges.count(); i++) {
                    if (!(await badges.nth(i).isVisible())) hidden.push(i);
                }
                assert.deepEqual(hidden, []);
            });
    });
});
