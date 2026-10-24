/**
 * @file capture.test.mjs
 * Two capture flows of the popup's send: a supported site's stored rules and headlines, and the workflow of
 * docs/development/adding-a-new-site.md — capture a page, edit its folder's selectors and Suola rule, update,
 * and the page converts again. Ports test_send_page… and test_edits_in_the_host_folder… from
 * the pre-split Python suite (the deleted devserver/ tree; its history lives in Klikkikuri/karikko); the recorded-capture hook of LiveServer becomes a read of the
 * capture folder; the edited folder is a file edit in the data directory.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./harness/browser.mjs";
import { stagedExtensionDir } from "./harness/extension.mjs";
import { e2eDataDir } from "../../tools/devserver-paths.mjs";
import { freePort, startServer } from "../../tools/devserver-server.mjs";
import { reloadUntilProcessed, sendPage, statuses, waitUntil } from "./harness/waits.mjs";
import { waitForCaptures } from "./harness/captures.mjs";

const DIST_DIR = process.env.DIST_DIR ?? "/app/build/dist";

/** The rule that the folder edit installs: only the lead article stays converted (the original's LEAD_RULE). */
const LEAD_RULE = { container: "article.lead", link: ":scope > a", title: "h2 span:last-child" };

describe("the popup's send of a supported site", () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    /** @type {Awaited<ReturnType<typeof launch>>} */
    let browser;

    const dataDir = e2eDataDir("capture");
    before(async () => {
        server = await startServer({ dataDir, port: await freePort() });
        browser = await launch(stagedExtensionDir(DIST_DIR, "capture"));
    });

    after(async () => {
        await browser?.close();
        await server?.stop();
    });

    test("posts the site rules and the original headlines, and the server stores them", async () => {
        await browser.addProvider(`http://localhost:${server.port}/manifest/ilta-pulu/manifest.json`);
        const site = await browser.newPage();
        await site.goto(`http://localhost:${server.port}/?seed=5`);
        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));

        const originalTitles = await site.evaluate(() =>
            [...document.querySelectorAll("[data-klikkikuri-original-title]")]
                .map((element) => element.dataset.klikkikuriOriginalTitle.trim()));

        const status = await sendPage(browser, `http://localhost:${server.port}`);
        assert.match(status, /^Done/);

        const { sites, links } = await waitForCaptures(dataDir, "localhost");
        const captured = sites.localhost;
        assert.ok(captured?.rules?.length > 0, "the capture must carry the site rules");
        for (const rule of captured.rules) {
            for (const key of ["container", "link", "title"]) assert.ok(key in rule);
        }
        // The server normalizes whitespace when it stores (captured.py writes " ".join(title.split())), so
        // the black-box equality is under the same collapse; the old LiveServer hook saw the raw sent text.
        const collapse = (title) => title.trim().split(/\s+/).join(" ");
        const stored = new Set(Object.values(links).map((link) => collapse(link.title)));
        assert.ok(originalTitles.length > 0, "the page must have converted headlines");
        for (const headline of originalTitles) {
            assert.ok(stored.has(collapse(headline)), "the converted headlines must be sent as the page showed them");
        }
        for (const headline of stored) assert.ok(!headline.startsWith("XFAIL VIOLATED"));
    });
});

describe("the adding-a-new-site workflow: capture, edit the folder, update", () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    /** @type {Awaited<ReturnType<typeof launch>>} */
    let browser;

    const dataDir = e2eDataDir("capture-edit");
    before(async () => {
        server = await startServer({ dataDir, port: await freePort() });
        browser = await launch(stagedExtensionDir(DIST_DIR, "capture-edit"));
        await browser.addProvider(`http://localhost:${server.port}/manifest/ilta-pulu/manifest.json`);
        await browser.addProvider(`http://localhost:${server.port}/manifest/captured-sites/manifest.json`);
    });

    after(async () => {
        await browser?.close();
        await server?.stop();
    });

    test("the edited selectors and Suola rule of a captured host apply at the next database update", async () => {
        const base = `http://127.0.0.1:${server.port}`;
        const site = await browser.newPage();
        await site.goto(`${base}/?seed=5`);
        const status = await sendPage(browser, base);
        assert.match(status, /^Done/);
        await waitForCaptures(dataDir, "127.0.0.1");
        assert.ok(await waitUntil(async () => (await statuses(site)).converted),
            "the popup must turn the site on first");

        const folder = join(dataDir, "captures", "127.0.0.1");
        const sitesFile = JSON.parse(await readFile(join(folder, "sites.json"), "utf8"));
        sitesFile.sites["127.0.0.1"].rules = [LEAD_RULE];
        await writeFile(join(folder, "sites.json"), JSON.stringify(sitesFile));
        await writeFile(join(folder, "rules.json"), JSON.stringify({ sites: [{
            domain: `127.0.0.1:${server.port}`,
            templates: [{ pattern: "^/[A-Za-z]+/a/(?P<Id>[0-9a-f]{12})", template: "https://dev.example/{{ .Id }}" }],
        }] }, null, 2));
        await browser.refresh();
        await reloadUntilProcessed(site);

        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));
        const devPrefix = await site.locator("[data-klikkikuri-converted-title^='[dev] ']").count();
        assert.ok(devPrefix > 0, "the links must be signed with the folder's Suola rule, as the server signed them");
        const statusesList = await site.evaluate(() =>
            [...document.querySelectorAll("[data-klikkikuri-status]")]
                .map((element) => Boolean(element.closest("article.lead"))));
        for (const inLead of statusesList) assert.ok(inLead, "only the edited rule applies");
    });
});
