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
 * The first truthy value of `predicate()`, or a timeout error at the deadline. A falsy result is retried until
 * then, so a count of 0 never looks like a timeout.
 *
 * @template T
 * @param {() => T | Promise<T>} predicate
 * @param {number} [timeoutMs]
 * @param {number} [intervalMs]
 * @returns {Promise<T>} - The first truthy value. Rejects when the deadline passes without one.
 */
export async function waitUntil(predicate, timeoutMs = 20000, intervalMs = 250) {
    const started = Date.now();
    for (;;) {
        const value = await predicate();
        if (value) return value;
        if (Date.now() - started > timeoutMs) throw new Error(`waitUntil: no truthy value within ${timeoutMs} ms`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

/**
 * The self-check mismatches once `[]`; a timeout error otherwise, like `waitUntil`. A list of mismatches at the
 * deadline is a failure with its content in the message, not a return value a caller has to remember to assert.
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
    throw new Error(`the self-check still reports ${found.length} mismatch(es) after ${timeoutMs} ms: `
        + `${JSON.stringify(found).slice(0, 500)}`);
}

/**
 * Whether the content script has run on the page: any status attribute proves that it did.
 *
 * @param {import("playwright-core").Page} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function processed(page, timeoutMs) {
    try {
        await waitUntil(async () => Object.keys(await statuses(page)).length > 0, timeoutMs);
        return true;
    } catch {
        return false;
    }
}

/**
 * Opens `url` and waits until the content script has processed the page. After a site change, the worker
 * re-registers the dynamic content scripts (updateDynamicContentScripts in src/background.js), and a page that
 * loads in between gets none — for good, because the page is already loaded. A reload is therefore part of the
 * open, not a retry of it.
 *
 * @param {import("playwright-core").Page} page
 * @param {string} url
 * @param {number} [attempts]
 * @returns {Promise<void>} Rejects when no load gets the content script.
 */
export async function gotoProcessed(page, url, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        await page.goto(url);
        if (await processed(page, 5000)) return;
    }
    throw new Error(`the content script did not run after ${attempts} loads of ${url}`);
}

/**
 * Reloads until the content script processes the page, for a page that is already open. Same race as
 * {@link gotoProcessed}.
 *
 * @param {import("playwright-core").Page} page
 * @param {number} [attempts]
 */
export async function reloadUntilProcessed(page, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        await page.reload();
        if (await processed(page, 5000)) return;
    }
}

/**
 * Clicks "Send page" in a popup whose active tab is the page at `base`, and waits for the send to finish. The
 * button is disabled while the capture runs and enabled again when it ends, whatever status text the locale shows
 * (finding 16). Returns the final status text for tests that check the count.
 *
 * @param {import("./browser.mjs").PaattiBrowser} browser
 * @param {string} base
 * @returns {Promise<string>}
 */
export async function sendPage(browser, base) {
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${browser.extensionId}/src/options/popup.html`);
    await popup.evaluate(async (base) => {
        const { default: browserApi } = await import("/src/browser-api.js");
        const [tab] = await browserApi.tabs.query({ url: `${base}/*` });
        await browserApi.tabs.update(tab.id, { active: true });
    }, base);
    await popup.reload();
    // The popup draws asynchronously. It binds the navigation listeners after several storage reads, so a
    // click that lands before that binding is lost: the radio lights up, but no handler shows the view. A
    // click on a hidden settings view then hides the capture row with its ancestor. Ask for both until
    // they report themselves, so a lost click is repaired instead of failing the case.
    const settingsView = popup.locator('[data-view="settings"]');
    const captureRow = popup.locator("#devmode-capture");
    await waitUntil(async () => {
        if (!await settingsView.isVisible()) await popup.click("label[for=open-settingsview]");
        return await settingsView.isVisible() && await captureRow.isVisible();
    }, 30000, 250);
    const button = popup.locator("#devmode-capture-button");
    await button.click();
    await waitUntil(() => button.isEnabled(), 60000, 200);
    return (await popup.locator("#devmode-capture-status").textContent()) ?? "";
}
