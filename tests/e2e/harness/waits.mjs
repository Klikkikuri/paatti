/**
 * @file waits.mjs
 * Wait helpers and the page reads that the tests share. `statuses` counts the extension's own status attributes;
 * `waitForMismatches` reads the self-check panel that the server writes into a shadow root.
 */

/** Counts the blocks by their `data-klikkikuri-status`, so a test can wait for the conversion to have run.
 * @param {import("playwright-core").Page} page
 * @returns {Promise<Record<string, number>>}
 */
export function statuses(page) {
    return page.evaluate(() => {
        /** @type {Record<string, number>} */
        const counts = {};
        for (const element of document.querySelectorAll("[data-klikkikuri-status]")) {
            counts[element.dataset.klikkikuriStatus] = (counts[element.dataset.klikkikuriStatus] || 0) + 1;
        }
        return counts;
    });
}

/**
 * The first truthy value of `predicate()`, or its falsy last one at the deadline.
 *
 * @template T
 * @param {() => T | Promise<T>} predicate
 * @param {number} [timeoutMs]
 * @param {number} [intervalMs]
 * @returns {Promise<T>}
 */
export function waitUntil(predicate, timeoutMs = 20000, intervalMs = 250) {
    return (async () => {
        const started = Date.now();
        for (;;) {
            const value = await predicate();
            if (value || Date.now() - started > timeoutMs) return value;
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    })();
}

/**
 * The self-check mismatches once `[]`, or the last list at the deadline.
 *
 * @param {import("playwright-core").Page} page
 * @param {number} [timeoutMs]
 * @returns {Promise<Array>}
 */
export async function waitForMismatches(page, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    let found = null;
    while (Date.now() < deadline) {
        found = await page.evaluate(() => (window.devserverMismatches ? window.devserverMismatches() : null));
        if (Array.isArray(found) && found.length === 0) return found;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // `null` means `window.devserverMismatches` is not on the page at all: the check panel is missing, not clean.
    // A stale run that dropped the panel must fail loudly, or the "expectations hold" cases check nothing.
    if (found === null) throw new Error("no self-check on the page; is ?check=1 set?");
    return found;
}

/**
 * Reloads until the content script processes the page. After a site change, the worker re-registers the content
 * scripts (updateDynamicContentScripts in src/background.js), and a page that loads in between gets none.
 *
 * @param {import("playwright-core").Page} page
 * @param {number} [attempts]
 */
export async function reloadUntilProcessed(page, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        await page.reload();
        const found = await waitUntil(() => statuses(page), 5000);
        if (Object.keys(found).length > 0) return;
    }
}

/**
 * Clicks "Send page" in a popup whose active tab is the page at `base`. Returns the status text.
 *
 * @param {import("./browser.mjs").PaattiBrowser} browser
 * @param {string} base
 * @returns {Promise<string>}
 */
export async function sendPage(browser, base) {
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${browser.extensionId}/src/options/popup.html`);
    await popup.evaluate(async (base) => {
        const [tab] = await chrome.tabs.query({ url: `${base}/*` });
        await chrome.tabs.update(tab.id, { active: true });
    }, base);
    await popup.reload();
    await popup.click("label[for=navi-settings]");
    await popup.click("#devmode-capture-button");
    const status = popup.locator("#devmode-capture-status");
    const text = await waitUntil(async () => {
        const value = (await status.textContent()) ?? "";
        return ["", "Sending…"].includes(value.trim()) ? null : value;
    });
    return text ?? "";
}
