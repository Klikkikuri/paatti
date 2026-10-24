// Checks a running development server against Paatti's own code: the provider resolver, the Suola module and the
// content script's scan, so that a change on either side that breaks the other fails here.
//
//   DEVSERVER_CAPTURES=<captures directory> node tools/devserver-drift.mjs <server base URL> [seed ...]
//
// `make test-devserver` copies tests/fixtures/captures into the server's data directory, starts the server
// and runs this. It needs the Suola artifacts in build/ (`make build-suola`) and jsdom through NODE_PATH, as
// `make test` does.
//
// For each page seed, it scans the page with the site rules as processSite does (src/contentScript.js), signs each
// link with the provider's named Suola set as the worker does, looks the sign up in the resolved Rahti data, and
// compares the status that results with the page's own data-expect-status. The status rule below is written from
// the content script, not copied from the server, so the two can disagree.

import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { TextDecoder, TextEncoder } from "node:util";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

const [base, ...seedArgs] = process.argv.slice(2);
if (!base) {
    console.error("usage: node tools/devserver-drift.mjs <server base URL> [seed ...]");
    process.exit(2);
}
const seeds = seedArgs.length > 0 ? seedArgs : ["1", "2", "3", "42", "1000"];
const manifestUrl = new URL("/manifest/ilta-pulu/manifest.json", base).href;

// Same order as the AGENTS.md test rule: the namespace before the dynamic import.
globalThis.browser = {};
const { inspect, resolve } = await import("../src/provider.js");
const { GENERIC_CAPTURE_RULE } = await import("../src/options/capture-target.js");

const LABEL_PAYWALLED = "com.github.klikkikuri/paywalled=true";
const LEVELS = ["Not Clickbait at all", "Slightly Clickbaity", "Moderately Clickbaity", "Very Clickbaity",
    "Extremely Clickbaity"];
const DEFAULT_THRESHOLD = 2;

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
 * For each link of the fixture folders and of `hosts`, the server's sign must be the sign that Paatti makes with the
 * provider's rules, and a link that has an entry must have it under that sign.
 *
 * The signs come from `/api/captures/<host>`, because a link of the `no_entry` case has no entry to look up.
 */
async function checkCaptureFolders(rahtiData, capturedUrl, hosts) {
    const directory = process.env.DEVSERVER_CAPTURES;
    if (!directory) return fail("DEVSERVER_CAPTURES is not set");
    for (const host of [...readdirSync(directory), ...hosts]) {
        const report = await (await fetch(new URL(`/api/captures/${host}`, base))).json();
        if (report.rules !== "ok") fail(`${host}: ${report.rules ?? report.detail}`);
        else if (!report.links.length) fail(`${host}: the check gives no links`);
        for (const { url, sign, entry } of report.links ?? []) {
            const paattiSign = globalThis.hashUrl(url, capturedUrl);
            if (sign !== paattiSign) fail(`${host}: the server signs ${url} as ${sign}, Paatti as ${paattiSign}`);
            else if (entry && !rahtiData[sign]) fail(`${host}: ${url} has no entry under Paatti's sign`);
        }
    }
    for (const link of LAYERED_LINKS) {
        if (globalThis.hashUrl(link, capturedUrl) === globalThis.hashUrl(link)) fail(`no folder rule signs ${link}`);
    }
}

/** The status that processSite writes for one scanned link, under the default development settings. */
function statusOf({ href, titleElem }, rahtiData, sign) {
    if (!titleElem || !href || !sign) return "skipped";
    const entry = rahtiData[sign];
    if (!entry) return "skipped";
    const level = LEVELS.indexOf(entry.clickbaitiness);
    if (entry.title && level !== -1 && level >= DEFAULT_THRESHOLD) return "converted";
    if (!entry.title && entry.labels?.includes(LABEL_PAYWALLED)) return "paywalled";
    return "original";
}

/** The containers, links and title elements that the rules find, as processSite collects them. */
function scan(document, rules) {
    const found = [];
    for (const rule of rules) {
        for (const container of document.querySelectorAll(rule.container)) {
            const links = !rule.link || rule.link === "self" || rule.link === ":scope"
                ? [container] : container.querySelectorAll(rule.link);
            for (const link of links) {
                const titleElem = rule.title === "self" || rule.title === ":scope"
                    ? container : (rule.title ? container.querySelector(rule.title) : link);
                found.push({ container, link, titleElem, href: link.getAttribute("href") });
            }
        }
    }
    return found;
}

const inspected = await inspect(manifestUrl, { loopbackProvidersEnabled: true });
if (inspected.error) {
    console.error(`  FAIL  inspect: ${inspected.error}`);
    process.exit(1);
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

// The captured-sites provider, after one capture of a page that no rule names, read as the popup reads it. Paatti
// must accept the site that the capture adds, and sign the captured link with the provider's rules as the server did.
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

    const scanned = scan(document, rules);
    const byContainer = new Map();
    for (const item of scanned) {
        const sign = item.href ? globalThis.hashUrl(new URL(item.href, pageUrl).href, manifestUrl) : null;
        byContainer.set(item.container, { ...item, status: statusOf(item, resolved.rahtiData, sign) });
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
process.exit(failures === 0 ? 0 : 1);
