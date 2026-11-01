/**
 * @file first-run.test.mjs
 * The first run in a real browser: the card that a converted page offers, the wizard tab that its Tour button
 * opens, and the popup's offer before and after the user finishes the wizard.
 *
 * This file is the only e2e suite of the wizard, and it covers only what a unit test cannot reach:
 * - a trusted click, because the card ignores a click that the page dispatches,
 * - a real message sender, because the background script accepts `openWizard` only from a content script that
 *   names its tab,
 * - a real tab, because the wizard opens in one and closes itself when it finishes,
 * - the module graph of the wizard page, because a broken import there gives a blank page.
 *
 * The rest is cheaper elsewhere: intro-card.test.mjs draws the card in jsdom, welcome-state.test.mjs fakes the
 * claim and the tab reuse, setup-line.test.mjs drives the offer, and welcome-deck.test.mjs holds the flow.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./harness/scenario.mjs";
import { gotoProcessed, statuses, waitUntil } from "./harness/waits.mjs";
import { SLIDES } from "../../src/options/welcome/deck.js";

/** The card's Tour button. Playwright pierces the card's open shadow root. */
const CARD_TOUR = "klikkikuri-intro-card button.tour";

/** The wizard page, from the extension root. */
const WIZARD_PATH = "/src/options/welcome/welcome.html";

/**
 * How long a negative wait watches for something that must not come.
 *
 * Both negative cases read one `storage.sync` key: the claim that the content script asks for after it converts
 * a page, and the `wizardDone` flag that the popup reads while it draws. A value that is already stored is
 * therefore known within a few hundred milliseconds of the page settling. This window is generous against that,
 * and it is not a wait for a timeout.
 */
const ABSENT_WINDOW_MS = 2000;

/** @param {number} [ms] @returns {Promise<void>} */
const settle = (ms = ABSENT_WINDOW_MS) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The open wizard tab, or null.
 *
 * @param {Awaited<ReturnType<typeof scenario>>} env
 * @returns {import("playwright-core").Page|null}
 */
const wizardTab = (env) => env.browser.context.pages().find((page) => page.url().includes(WIZARD_PATH)) ?? null;

/**
 * Opens the popup page. Like the toolbar popup, it needs the extension's own address, not a server address.
 *
 * @param {Awaited<ReturnType<typeof scenario>>} env
 * @returns {Promise<import("playwright-core").Page>}
 */
async function openPopup(env) {
    const page = await env.browser.newPage();
    await page.goto(`chrome-extension://${env.browser.extensionId}/src/options/popup.html`);
    return page;
}

describe("the first run", () => {
    /** @type {Awaited<ReturnType<typeof scenario>>} */
    let env;

    before(async () => {
        env = await scenario("first-run");
        await env.browser.addProvider(`${env.base}/manifest/ilta-pulu/manifest.json`);
        await env.browser.addProvider(`${env.base}/manifest/captured-sites/manifest.json`);
    });

    after(async () => {
        await env?.close();
    });

    test("the Tour button of the card opens the wizard in tour mode", async () => {
        const page = await env.browser.newPage();
        await gotoProcessed(page, `${env.base}/?seed=5`);

        const tour = page.locator(CARD_TOUR);
        await waitUntil(async () => (await tour.count()) > 0, 20000);
        // A real click: the card's buttons run only on an event that the browser marks as trusted.
        await tour.click();

        const wizard = await waitUntil(() => wizardTab(env), 20000);
        assert.match(wizard.url(), /[?&]mode=tour\b/, `the wizard must open in the mode of the button, not ${wizard.url()}`);

        // `dataset.mode` is written by the page's own module, so it proves that the module graph loaded, not only
        // that the markup arrived.
        const mode = await waitUntil(async () => {
            try {
                return await wizard.evaluate(() => document.documentElement.dataset.mode || null);
            } catch {
                // The tab is still navigating.
                return null;
            }
        }, 15000);
        assert.equal(mode, "tour");
        await wizard.locator("#slide-welcome").waitFor({ state: "visible" });
        assert.equal(await wizard.locator("section.slide").count(), SLIDES.length,
            "the page must hold every slide of the deck");
        assert.ok(await wizard.locator("#skip").isVisible(), "a slide of the deck must offer a way out");

        // The card enters the page, so it must carry nothing that differs per install (docs/fingerprinting.md).
        const html = await page.evaluate(() => document.documentElement.outerHTML);
        assert.ok(!html.includes("chrome-extension://"), "the card must put no address of the extension into the page");

        await wizard.close();
    });

    test("a second page of the same install gets no card", async () => {
        const page = await env.browser.newPage();
        await gotoProcessed(page, `${env.base}/?seed=5`);
        const converted = await waitUntil(async () => (await statuses(page)).converted, 20000);
        assert.ok(converted, JSON.stringify(await statuses(page)));

        // The content script asks for the card only after it converts a page. The claim is stored before the card
        // is drawn, so a card that this page could get would arrive in the window below.
        await settle();
        assert.equal(await page.locator(CARD_TOUR).count(), 0, "the claim is handed out once per install");
        await page.close();
    });

    test("the popup offers the wizard until the user finishes it", async () => {
        const first = await openPopup(env);
        const offered = first.locator("#setup-line");
        await offered.waitFor({ state: "visible" });
        await offered.locator('button[data-mode="tour"]').click();

        const wizard = await waitUntil(() => wizardTab(env), 20000);
        await wizard.locator("#skip").click();
        await waitUntil(() => wizard.isClosed(), 20000);

        const done = await env.browser.run(async () => {
            const { default: browser } = await import("/src/browser-api.js");
            const { wizardDone } = await browser.storage.sync.get("wizardDone");
            return wizardDone === true;
        });
        assert.ok(done, "leaving the wizard must mark it done");

        const second = await openPopup(env);
        // The offer starts hidden. Only a bounded window can show that it does not come back, so it is watched
        // for as long as the stored flag needs to be read and acted on.
        await settle();
        assert.equal(await second.locator("#setup-line").isVisible(), false, "a finished wizard must not be offered again");
    });
});
