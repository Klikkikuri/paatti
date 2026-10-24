/**
 * @file capture.test.mjs
 * Two capture flows of the popup's send: a supported site's stored rules and headlines, and the workflow of
 * docs/development/adding-a-new-site.md — capture a page, edit its folder's selectors and Suola rule, update,
 * and the page converts again. The recorded-capture hook becomes a read of the capture folder in the scenario's
 * data directory; the edited folder is a file edit there.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./harness/scenario.mjs";
import { reloadUntilProcessed, sendPage, statuses, waitUntil } from "./harness/waits.mjs";
import { waitForCaptures } from "./harness/captures.mjs";

/** The rule that the folder edit installs: only the lead article stays converted. */
const LEAD_RULE = { container: "article.lead", link: ":scope > a", title: "h2 span:last-child" };

describe("the popup's send of a supported site", () => {
    /** @type {Awaited<ReturnType<typeof scenario>>} */
    let env;

    before(async () => {
        env = await scenario("capture");
    });

    after(async () => {
        await env?.close();
    });

    test("posts the site rules and the original headlines, and the server stores them", async () => {
        await env.browser.addProvider(`${env.base}/manifest/ilta-pulu/manifest.json`);
        const site = await env.browser.newPage();
        await site.goto(`${env.base}/?seed=5`);
        const converted = await waitUntil(async () => (await statuses(site)).converted);
        assert.ok(converted, JSON.stringify(await statuses(site)));

        const originalTitles = await site.evaluate(() =>
            [...document.querySelectorAll("[data-klikkikuri-original-title]")]
                .map((element) => element.dataset.klikkikuriOriginalTitle.trim()));

        await sendPage(env.browser, env.base);

        const { sites, links } = await waitForCaptures(env.dataDir, "localhost");
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
    /** @type {Awaited<ReturnType<typeof scenario>>} */
    let env;

    before(async () => {
        env = await scenario("capture-edit");
        await env.browser.addProvider(`${env.base}/manifest/ilta-pulu/manifest.json`);
        await env.browser.addProvider(`${env.base}/manifest/captured-sites/manifest.json`);
    });

    after(async () => {
        await env?.close();
    });

    test("the edited selectors and Suola rule of a captured host apply at the next database update", async () => {
        const base = `http://127.0.0.1:${env.server.port}`;
        const site = await env.browser.newPage();
        await site.goto(`${base}/?seed=5`);
        await sendPage(env.browser, base);
        await waitForCaptures(env.dataDir, "127.0.0.1");
        assert.ok(await waitUntil(async () => (await statuses(site)).converted),
            "the popup must turn the site on first");

        const folder = join(env.dataDir, "captures", "127.0.0.1");
        const sitesFile = JSON.parse(await readFile(join(folder, "sites.json"), "utf8"));
        sitesFile.sites["127.0.0.1"].rules = [LEAD_RULE];
        await writeFile(join(folder, "sites.json"), JSON.stringify(sitesFile));
        await writeFile(join(folder, "rules.json"), JSON.stringify({ sites: [{
            domain: `127.0.0.1:${env.server.port}`,
            templates: [{ pattern: "^/[A-Za-z]+/a/(?P<Id>[0-9a-f]{12})", template: "https://dev.example/{{ .Id }}" }],
        }] }, null, 2));
        await env.browser.refresh();
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
