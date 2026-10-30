// Checks a running development server against Paatti's own code: the provider resolver, the Suola module and the
// content script's scan, so that a change on either side that breaks the other fails here.
//
//   node tools/devserver-drift.mjs            # starts its own karikko, runs the checks, stops it
//   node tools/devserver-drift.mjs <base URL> [seed ...]   # checks a server someone else started
//
// The default run owns the whole lifecycle through tools/devserver-server.mjs — start, readiness, stop — and gives
// the capture check its own data directory under build/e2e, so nothing is written into `tests/fixtures/captures`.
// With a base URL, the caller owns the server; DEVSERVER_CAPTURES=<captures directory> names the folders to
// compare against.
//
// It needs the Suola artifacts in build/ (`make build-suola`) and jsdom through NODE_PATH, as `make test` does.
//
// For each page seed, it scans the page with the site rules as processSite does (src/contentScript.js), signs each
// link with the provider's named Suola set as the worker does, looks the sign up in the resolved Rahti data, and
// compares the status that results with the page's own data-expect-status. The scan semantics come from
// src/site-rules-scan.js, shared with the extension. This guard keeps its own page-reading code on purpose: it
// re-derives what the extension would do and compares that with the expectations the server's pages carry — never
// with the server's own logic.

import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder, TextEncoder } from "node:util";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

// The CLI's own argument handling, before the module-level checks run. No argument is valid: the default run
// starts its own server. An empty first argument is a mistake, not a request for that mode.
const [baseArg, ...seedArgs] = process.argv.slice(2);
if (baseArg !== undefined && !baseArg) {
    console.error("usage: node tools/devserver-drift.mjs [<server base URL> [seed ...]]");
    process.exit(2);
}
const seeds = seedArgs.length > 0 ? seedArgs : ["1", "2", "3", "42", "1000"];

// Same order as the AGENTS.md test rule: the namespace before the dynamic import.
globalThis.browser = {};
const { inspect, resolve } = await import("../src/provider.js");
const { GENERIC_CAPTURE_RULE } = await import("../src/options/capture-target.js");
const { scanSiteRules, decideStatus } = await import("../src/site-rules-scan.js");
const { e2eDataDir } = await import("./devserver-paths.mjs");
const { startServer } = await import("./devserver-server.mjs");

/**
 * The server this run checks: either one the caller started (a base URL is given), or one this tool starts on a
 * free port with its own data directory and stops at the end. `dataDir` is the server's data root; its host
 * folders live under `<dataDir>/captures`. For a self-owned server that root is fresh, so the capture POST fills
 * it instead of touching `tests/fixtures/captures`.
 */
let owned;
let base;
let dataDir;
let fixtureMode;
if (baseArg) {
    if (!process.env.DEVSERVER_CAPTURES) {
        console.error("drift: DEVSERVER_CAPTURES is required when a base URL is given");
        process.exit(2);
    }
    base = baseArg;
    // DEVSERVER_CAPTURES names the captures level itself (the folder that holds <host>/); derive the data root
    // from it so both modes read hosts from <dataDir>/captures.
    dataDir = join(process.env.DEVSERVER_CAPTURES, "..");
    fixtureMode = true;
} else {
    dataDir = e2eDataDir(`drift-${process.pid}`);
    owned = await startServer({ dataDir, flags: ["--log_level=WARNING"] });
    base = `http://localhost:${owned.port}`;
    fixtureMode = false;
}
const manifestUrl = new URL("/manifest/ilta-pulu/manifest.json", base).href;

let failures = 0;
const fail = (message) => {
    failures += 1;
    console.error(`  FAIL  ${message}`);
};

async function loadSuola() {
    globalThis.require = require;
    globalThis.TextEncoder = TextEncoder;
    globalThis.TextDecoder = TextDecoder;
    require(new URL("../build/wasm_exec.js", import.meta.url).pathname);
    const go = new globalThis.Go();
    const wasm = readFileSync(new URL("../build/js.wasm", import.meta.url));
    const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
    go.run(instance);
}

// Fixture links that a folder rule must sign: one for a base domain (yle.fi), and one through a rule for a parent
// domain in another folder (example.fi). A server that signs without Paatti's precedence fails on these.
const LAYERED_LINKS = ["https://yle.fi/a/74-20012345", "https://uutiset.example.fi/2/otsikko"];

/**
 * For each link of the capture folders and of `hosts`, the server's sign must be the sign that Paatti makes with the
 * provider's rules, and a link that has an entry must have it under that sign.
 *
 * The signs come from `/api/captures/<host>`, because a link of the `no_entry` case has no entry to look up.
 */
async function checkCaptureFolders(rahtiData, capturedUrl, hosts) {
    // The server keeps its host folders under <data_dir>/captures.
    const root = join(dataDir, "captures");
    const folders = existsSync(root) ? readdirSync(root) : [];
    for (const host of [...folders, ...hosts]) {
        const report = await (await fetch(new URL(`/api/captures/${host}`, base))).json();
        if (report.rules !== "ok") fail(`${host}: ${report.rules ?? report.detail}`);
        else if (!report.links.length) fail(`${host}: the check gives no links`);
        for (const { url, sign, entry } of report.links ?? []) {
            const paattiSign = globalThis.hashUrl(url, capturedUrl);
            if (sign !== paattiSign) fail(`${host}: the server signs ${url} as ${sign}, Paatti as ${paattiSign}`);
            else if (entry && !rahtiData[sign]) fail(`${host}: ${url} has no entry under Paatti's sign`);
        }
    }
    // A folder rule must change the sign against the base rules: that is the precedence Paatti relies on. Only the
    // fixtures carry folders for these hosts; a self-owned run POSTs one link instead, which the loop above checks.
    // Suola refuses to sign a javascript: address and returns null; two nulls are equal but prove nothing, so an
    // unsignable link is not a precedence failure.
    if (fixtureMode) {
        for (const link of LAYERED_LINKS) {
            const named = globalThis.hashUrl(link, capturedUrl);
            if (named === null) continue;
            if (named === globalThis.hashUrl(link)) fail(`no folder rule signs ${link}`);
        }
    }
}

/** The status that processSite writes for one scanned link, under the default development settings. */
const statusOf = decideStatus;

async function runChecks() {
    const inspected = await inspect(manifestUrl, { loopbackProvidersEnabled: true });
    if (inspected.error) {
        fail(`inspect: ${inspected.error}`);
        return;
    }
    const resolved = await resolve(inspected.manifest, manifestUrl, { loopbackProvidersEnabled: true });

    console.log(`Provider ${manifestUrl}`);
    if (resolved.rejected.length) fail(`rejected: ${JSON.stringify(resolved.rejected)}`);
    if (resolved.errors.length) fail(`errors: ${JSON.stringify(resolved.errors)}`);
    if (!resolved.siteConfigs.localhost) fail("no site `localhost`");
    if (!resolved.suolaRules) fail("no Suola rules");
    const entryCount = Object.keys(resolved.rahtiData).length;
    if (entryCount === 0) fail("no Rahti entries");
    console.log(`  ${entryCount} Rahti signs, ${resolved.siteConfigs.localhost?.rules.length ?? 0} site rules`);

    await loadSuola();
    const refused = globalThis.defineRules(manifestUrl, JSON.stringify(resolved.suolaRules));
    if (refused) fail(`Suola refused the provider rules: ${refused}`);

    // The captured-sites provider, after one capture of a page that no rule names, read as the popup reads it.
    // Paatti must accept the site that the capture adds, and sign the captured link with the provider's rules as
    // the server did.
    const capturedUrl = new URL("/manifest/captured-sites/manifest.json", base).href;
    const capturedLink = "https://example.org/news/story-1";
    const posted = await fetch(new URL("/api/capture", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            pageUrl: "https://example.org/", rules: [GENERIC_CAPTURE_RULE], links: [{ href: capturedLink, title: "Story" }]
        })
    });
    console.log(`Provider ${capturedUrl}`);
    if (!posted.ok) fail(`capture: HTTP ${posted.status}`);
    const capturedInspected = await inspect(capturedUrl, { loopbackProvidersEnabled: true });
    const captured = capturedInspected.error
        ? { error: capturedInspected.error }
        : await resolve(capturedInspected.manifest, capturedUrl, { loopbackProvidersEnabled: true });
    if (captured.error) fail(`captured-sites: ${captured.error}`);
    else {
        if (captured.rejected.length) fail(`captured-sites rejected: ${JSON.stringify(captured.rejected)}`);
        if (captured.errors.length) fail(`captured-sites errors: ${JSON.stringify(captured.errors)}`);
        if (!captured.siteConfigs["example.org"]) fail("captured-sites has no site `example.org`");
        const capturedRefused = globalThis.defineRules(capturedUrl, JSON.stringify(captured.suolaRules));
        if (capturedRefused) fail(`Suola refused the captured-sites rules: ${capturedRefused}`);
        else await checkCaptureFolders(captured.rahtiData, capturedUrl, [new URL(capturedLink).hostname]);
        console.log(`  ${Object.keys(captured.siteConfigs).length} captured sites`);
    }

    const rules = resolved.siteConfigs.localhost?.rules ?? [];
    for (const seed of seeds) {
        const pageUrl = new URL(`/?seed=${seed}`, base).href;
        const html = await (await fetch(pageUrl)).text();
        const { document } = new JSDOM(html, { url: pageUrl }).window;

        const scanned = scanSiteRules(document, rules, pageUrl);
        const byContainer = new Map();
        for (const item of scanned) {
            // scanSiteRules resolves the href against the page. A non-http(s) address, or a missing one, cannot be
            // signed: decideStatus returns "skipped" for it, as processSite does. Both an expected failure and an
            // xfail block pass on that.
            const sign = item.href && /^https?:/.test(item.href) ? globalThis.hashUrl(item.href, manifestUrl) : null;
            const entry = sign ? resolved.rahtiData[sign] : null;
            byContainer.set(item.container, { ...item, status: statusOf(item, entry, sign) });
        }

        let checked = 0;
        for (const element of document.querySelectorAll("[data-expect-status]")) {
            const expected = element.dataset.expectStatus;
            const where = `seed ${seed}, ${element.dataset.devserverBlock} (${element.dataset.expectPath})`;
            const actual = byContainer.get(element)?.status;
            checked += 1;
            if (expected === "gap") continue;
            if (expected === "xfail") {
                if (actual !== undefined && actual !== "skipped") fail(`${where}: an expected failure got ${actual}`);
            } else if (actual === undefined) {
                fail(`${where}: no rule matched a block that expects ${expected}`);
            } else if (actual !== expected) {
                fail(`${where}: expected ${expected}, the extension's logic gives ${actual}`);
            }
        }
        for (const { container } of scanned) {
            if (!container.hasAttribute("data-expect-status")) {
                fail(`seed ${seed}: a rule matched an element without an expectation: ${container.outerHTML.slice(0, 120)}`);
            }
        }
        console.log(`  seed ${seed}: ${checked} annotated elements, ${scanned.length} scanned links`);
    }

    console.log(failures === 0 ? "Drift guard: ok" : `Drift guard: ${failures} failure(s)`);
}

// A self-owned server must die on every exit path, including a fetch or parse error inside the checks. Its data
// directory goes with it: the tool created it, and a kept copy would be stale state for the next run.
try {
    await runChecks();
} finally {
    if (owned) {
        await owned.stop();
        rmSync(dataDir, { recursive: true, force: true });
    }
}
process.exit(failures === 0 ? 0 : 1);
