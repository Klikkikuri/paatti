/**
 * @file provider-faults.test.mjs
 * Each provider fault, after one clean refresh, gives the provider state that the fault table names. The server's
 * chaos settings are spawn-time flags, so each case restarts karikko on the same port with its own flags.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./harness/scenario.mjs";
import { statuses, waitUntil } from "./harness/waits.mjs";

const BASE = "http://localhost";

/** The entry count of a healthy Ilta-Pulu: read from the server's own data document, never hardcoded here —
 * a karikko pool bump must not fail this suite without a Paatti change. */
async function fullEntryCount(base) {
    const data = await (await fetch(`${base}/manifest/ilta-pulu/data.json`)).json();
    return data.entries.length;
}

const CASES = [
    // [flags, check of the provider data after the failing refresh]
    [["--chaos.provider_5xx=data"],
        (data, before, full) => data.entryCount === full && data.updated === before.updated
            && data.errors.some((error) => error.transient)],
    [["--chaos.provider_429=data"],
        (data, _before, full) => data.entryCount === full && data.errors.some((error) => error.retryAfterMs === 5000)],
    [["--chaos.provider_redirect=data"],
        (data, before, full) => data.entryCount === full && data.updated === before.updated
            && data.errors.some((error) => error.transient)],
    [["--chaos.provider_404=data"],
        (data, _before, _full) => data.entryCount === 0 && data.errors.some((error) => error.message === "HTTP 404")],
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
        (data, _before, full) => data.entryCount === full && data.errors.some((error) => error.transient)],
];

describe("each provider fault after one clean refresh", () => {
    /** @type {Awaited<ReturnType<typeof scenario>>} */
    let env;
    let FULL;

    before(async () => {
        env = await scenario("faults");
        FULL = await fullEntryCount(env.base);
        assert.ok(FULL > 100, `the pool gave ${FULL} entries; expected a real dataset`);
    });

    after(async () => {
        await env?.close();
    });

    for (const [flags, check] of CASES) {
        test(flags.join(" "), async () => {
            const manifestUrl = `${BASE}:${env.server.port}/manifest/ilta-pulu/manifest.json`;
            await env.server.restart([]); // The clean refresh each case starts from.
            await env.browser.addProvider(manifestUrl);
            const previous = await env.browser.providerData(manifestUrl);
            assert.deepEqual(previous.errors, []);
            assert.equal(previous.entryCount, FULL);

            await env.server.restart(flags);
            await env.browser.refresh();
            const current = await env.browser.providerData(manifestUrl);
            assert.ok(check(current, previous, FULL), JSON.stringify({ current, previous }));
        });
    }

    test("rejected sites keep the provider's own name and drop the four rejected ones", async () => {
        const manifestUrl = `${BASE}:${env.server.port}/manifest/ilta-pulu/manifest.json`;
        await env.server.restart(["--chaos.rejected_sites=true"]);
        await env.browser.addProvider(manifestUrl);
        const data = await env.browser.providerData(manifestUrl);
        assert.equal(data.rejected.length, 4);
        assert.ok(data.sites.includes("localhost"), JSON.stringify(data));
    });

    test("refused rules leave every link unconverted", async () => {
        const manifestUrl = `${BASE}:${env.server.port}/manifest/ilta-pulu/manifest.json`;
        await env.server.restart(["--chaos.bad_rules=true"]);
        await env.browser.addProvider(manifestUrl);
        const data = await env.browser.providerData(manifestUrl);
        assert.ok(data.hasRules, JSON.stringify(data));
        const page = await env.browser.newPage();
        await page.goto(`http://localhost:${env.server.port}/?seed=3`);
        const counts = await waitUntil(async () => {
            const all = await statuses(page);
            return all.skipped ? all : null;
        });
        assert.deepEqual(Object.keys(counts).sort(), ["skipped"], JSON.stringify(counts));
    });
});

