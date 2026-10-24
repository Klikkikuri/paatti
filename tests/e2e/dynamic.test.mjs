/**
 * @file dynamic.test.mjs
 * Content that arrives after the first conversion pass, page faults, and the popup's main-page entry. Ports
 * the pre-split Python suite (the deleted devserver/ tree; its history lives in Klikkikuri/karikko); the server's chaos settings are spawn-time flags, so each test restarts
 * the server on the same port with its own flags.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./harness/browser.mjs";
import { stagedExtensionDir } from "./harness/extension.mjs";
import { e2eDataDir } from "../../tools/devserver-paths.mjs";
import { freePort, startServer } from "../../tools/devserver-server.mjs";
import { statuses, waitForMismatches, waitUntil } from "./harness/waits.mjs";
import { convertedArticle, firstSeedWith } from "./harness/articles.mjs";

const DIST_DIR = process.env.DIST_DIR ?? "/app/build/dist";
const BADGES = "klikkikuri-converted-badge, klikkikuri-ai-badge, klikkikuri-video-badge";

describe("content that arrives after the first conversion pass", () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    /** @type {Awaited<ReturnType<typeof launch>>} */
    let browser;

    before(async () => {
        server = await startServer({ dataDir: e2eDataDir("dynamic"), port: await freePort() });
        browser = await launch(stagedExtensionDir(DIST_DIR, "dynamic"));
        await browser.addProvider(`http://localhost:${server.port}/manifest/ilta-pulu/manifest.json`);
    });

    after(async () => {
        await browser?.close();
        await server?.stop();
    });

    /** Opens a checked page and expects its self-check mismatches to settle at none.
     * @param {string} base
     * @param {number} seed
     */
    async function openChecked(base, seed) {
        const page = await browser.newPage();
        await page.goto(`${base}/?seed=${seed}&check=1`);
        assert.deepEqual(await waitForMismatches(page), []);
        return page;
    }

    test("load-more and ticker replacements are converted", async () => {
        const base = `http://localhost:${server.port}`;
        const page = await openChecked(base, 7);
        await page.click("#load-more");
        assert.ok(await waitUntil(async () => (await page.locator("[data-devserver-source^='more:']").count()) > 0));
        assert.ok(await waitUntil(async () => (await page.locator("[data-devserver-source^='ticker:']").count()) > 0, 12000));
        assert.deepEqual(await waitForMismatches(page), []);
    });

    test("late content is converted", async () => {
        const base = `http://localhost:${server.port}`;
        await server.restart(["--chaos.page_late_content=true"]);
        const seed = await firstSeedWith(base, "<template data-devserver-late");
        assert.ok(seed !== null, "no seed produces late content");
        const page = await openChecked(base, seed);
        const late = page.locator("[data-devserver-chaos='page_late_content']");
        assert.ok(await waitUntil(async () => (await late.count()) > 0));
        assert.deepEqual(await waitForMismatches(page), []);
    });

    test("churned cards get their own status", async () => {
        const base = `http://localhost:${server.port}`;
        await server.restart(["--chaos.page_dom_churn=true"]);
        const page = await openChecked(base, 13);
        const churned = page.locator("[data-devserver-chaos^='page_dom_churn']");
        assert.ok(await waitUntil(async () => (await churned.count()) >= 2, 15000));
        assert.deepEqual(await waitForMismatches(page), []);
    });

    test("an article page is the main page entry", async () => {
        // Runs with the server's base flags: the chaos cases below restart the server with their own flags and
        // leave them, so this test sits before them (the Python original had a fresh LiveServer per test).
        const base = `http://localhost:${server.port}`;
        const article = await convertedArticle(browser, base);
        assert.ok(article, "the front page must contain a converted article");
        const page = await browser.newPage();
        await page.goto(`${base}${article.href}`);
        assert.ok(await waitUntil(async () => (await statuses(page)).converted));

        const url = `${base}${article.href}`;
        const [main] = await browser.run(async (tabUrl) => {
            const [tab] = await chrome.tabs.query({ url: tabUrl });
            return chrome.tabs.sendMessage(tab.id, { command: "getConversions" });
        }, url);
        assert.ok(main?.isMainPage, JSON.stringify(main));
        assert.equal(main.convertedTitle, article.convertedTitle,
            "the article's converted title must be the rahti entry, as the front page showed it");
    });

    describe("badges under hostile css", () => {
        before(async () => {
            await server.restart(["--chaos.page_hostile_css=true"]);
        });

        test("badges keep their size", async () => {
            const page = await openChecked(`http://localhost:${server.port}`, 17);
            const badges = page.locator(BADGES);
            assert.ok((await badges.count()) > 0);
            const sizeless = [];
            for (let i = 0; i < await badges.count(); i++) {
                const box = await badges.nth(i).boundingBox();
                if (!box?.width) sizeless.push(i);
            }
            assert.deepEqual(sizeless, [], `${sizeless.length} of ${await badges.count()} badges have no size`);
        });

        // `todo` keeps the body running and reports an unexpected pass — the Python suite's strict xfail.
        test("badges stay visible -- known extension gap, xfail strict in the Python suite",
            { todo: "known extension gap: the badges force display, not visibility" }, async () => {
                const page = await openChecked(`http://localhost:${server.port}`, 17);
                const badges = page.locator(BADGES);
                const hidden = [];
                for (let i = 0; i < await badges.count(); i++) {
                    if (!(await badges.nth(i).isVisible())) hidden.push(i);
                }
                assert.deepEqual(hidden, []);
            });
    });
});
