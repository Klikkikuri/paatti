/**
 * @file provider-faults.test.mjs
 * Each provider fault, after one clean refresh, gives the provider state that the fault table names. Ports
 * the pre-split Python suite (the deleted devserver/ tree; its history lives in Klikkikuri/karikko); LiveServer.set_chaos is a stop-spawn on the same port with
 * `--chaos.*` flags.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./harness/browser.mjs";
import { stagedExtensionDir } from "./harness/extension.mjs";
import { e2eDataDir } from "../../tools/devserver-paths.mjs";
import { freePort, startServer } from "../../tools/devserver-server.mjs";
import { statuses, waitUntil } from "./harness/waits.mjs";

const DIST_DIR = process.env.DIST_DIR ?? "/app/build/dist";
const FULL = 186; // The entries of the default pool; the pool itself is the submodule's own test suite's subject.
const BASE = "http://localhost";

const CASES = [
    // [flags, check of the provider data after the failing refresh]
    [["--chaos.provider_5xx=data"],
        (data, before) => data.entryCount === FULL && data.updated === before.updated
            && data.errors.some((error) => error.transient)],
    [["--chaos.provider_429=data"],
        (data) => data.entryCount === FULL && data.errors.some((error) => error.retryAfterMs === 5000)],
    [["--chaos.provider_redirect=data"],
        (data, before) => data.entryCount === FULL && data.updated === before.updated
            && data.errors.some((error) => error.transient)],
    [["--chaos.provider_404=data"],
        (data) => data.entryCount === 0 && data.errors.some((error) => error.message === "HTTP 404")],
    [["--chaos.malformed_json=data"],
        (data) => data.entryCount === 0 && data.errors.length > 0],
    [["--chaos.oversize=data"],
        (data) => data.entryCount === 0 && data.errors.length > 0],
    [["--chaos.schema_mismatch=data"],
        (data) => data.entryCount === 0 && data.errors.some((error) => error.message.includes("not compatible"))],
    [["--chaos.schema_mismatch=manifest"],
        (data, before) => data.updated === before.updated
            && data.errors.some((error) => error.message.includes("schema_version"))],
    [["--chaos.provider_timeout=data", "--chaos.provider_latency_ms=11000"],
        (data) => data.entryCount === FULL && data.errors.some((error) => error.transient)],
];

describe("each provider fault after one clean refresh", () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    /** @type {Awaited<ReturnType<typeof launch>>} */
    let browser;

    before(async () => {
        server = await startServer({ dataDir: e2eDataDir("faults"), port: await freePort() });
        browser = await launch(stagedExtensionDir(DIST_DIR, "faults"));
    });

    after(async () => {
        await browser?.close();
        await server?.stop();
    });

    for (const [flags, check] of CASES) {
        test(flags.join(" "), async () => {
            const manifestUrl = `${BASE}:${server.port}/manifest/ilta-pulu/manifest.json`;
            await server.restart([]); // The clean refresh each case starts from.
            await browser.addProvider(manifestUrl);
            const previous = await browser.providerData(manifestUrl);
            assert.deepEqual(previous.errors, []);
            assert.equal(previous.entryCount, FULL);

            await server.restart(flags);
            await browser.refresh();
            const current = await browser.providerData(manifestUrl);
            assert.ok(check(current, previous), JSON.stringify({ current, previous }));
        });
    }

    test("rejected sites keep the provider's own name and drop the four rejected ones", async () => {
        const manifestUrl = `${BASE}:${server.port}/manifest/ilta-pulu/manifest.json`;
        await server.restart(["--chaos.rejected_sites=true"]);
        await browser.addProvider(manifestUrl);
        const data = await browser.providerData(manifestUrl);
        assert.equal(data.rejected.length, 4);
        assert.ok(data.sites.includes("localhost"), JSON.stringify(data));
    });

    test("refused rules leave every link unconverted", async () => {
        const manifestUrl = `${BASE}:${server.port}/manifest/ilta-pulu/manifest.json`;
        await server.restart(["--chaos.bad_rules=true"]);
        await browser.addProvider(manifestUrl);
        const data = await browser.providerData(manifestUrl);
        assert.ok(data.hasRules, JSON.stringify(data));
        const page = await browser.newPage();
        await page.goto(`http://localhost:${server.port}/?seed=3`);
        const counts = await waitUntil(async () => {
            const all = await statuses(page);
            return all.skipped ? all : null;
        });
        assert.ok(counts, JSON.stringify(await statuses(page)));
        assert.deepEqual(Object.keys(counts).sort(), ["skipped"], JSON.stringify(counts));
    });
});

