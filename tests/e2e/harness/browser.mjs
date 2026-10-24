/**
 * @file browser.mjs
 * A persistent Chromium context with the staged extension, and the helpers that run the extension's own modules:
 * the options page does the adds and the refreshes; everything here drives code loaded from the extension URL.
 */

import { chromium } from "playwright-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADD_PROVIDER = async (manifestUrl) => {
    const { getConfig } = await import("/src/config.js");
    for (let i = 0; i < 50 && (await getConfig()).activeEnv !== "development"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const { controller } = await import("/src/controller.js");
    const { addProvider, refreshProviders } = await import("/src/providers.js");
    await controller.setLoopbackProvidersEnabled(true);
    await addProvider(manifestUrl);
    await refreshProviders();
    await controller.setSiteEnabled(true, "localhost");
    const config = await getConfig();
    return { activeEnv: config.activeEnv, data: config.providerData[manifestUrl] };
};

const REFRESH = async () => {
    const { refreshProviders } = await import("/src/providers.js");
    return refreshProviders();
};

const PROVIDER_DATA = async (manifestUrl) => {
    const { getConfig } = await import("/src/config.js");
    const data = (await getConfig()).providerData[manifestUrl];
    return data && { errors: data.errors, rejected: data.rejected, entryCount: data.entryCount,
                     updated: data.updated, checked: data.checked, sites: Object.keys(data.siteConfigs),
                     hasRules: Boolean(data.suolaRules) };
};

/**
 * The helper surface of the launched browser.
 *
 * @typedef {object} PaattiBrowser
 * @property {import("playwright-core").BrowserContext} context
 * @property {string} extensionId
 * @property {(script: string, arg?: unknown) => Promise<unknown>} run
 * @property {(url: string) => Promise<unknown>} addProvider
 * @property {() => Promise<unknown>} refresh
 * @property {(url: string) => Promise<unknown>} providerData
 * @property {() => Promise<import("playwright-core").Page>} newPage
 * @property {() => Promise<void>} close
 */

/**
 * Launches Chromium with the staged extension, and returns the helpers once the service worker is up.
 *
 * @param {string} extensionDir - The staged extension's directory.
 * @returns {Promise<PaattiBrowser>}
 */
export async function launch(extensionDir) {
    const context = await chromium.launchPersistentContext(profileDir(), {
        executablePath: process.env.CHROMIUM ?? "/usr/lib/chromium/chromium",
        headless: true,
        args: [
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`,
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = worker.url().split("/")[2];

    const extensionPage = async () => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
        return page;
    };
    const run = async (script, arg) => {
        const page = await extensionPage();
        try {
            return await page.evaluate(script, arg);
        } finally {
            await page.close();
        }
    };

    return {
        context,
        extensionId,
        run,
        addProvider: (manifestUrl) => run(ADD_PROVIDER, manifestUrl),
        refresh: () => run(REFRESH),
        providerData: (manifestUrl) => run(PROVIDER_DATA, manifestUrl),
        newPage: () => context.newPage(),
        close: () => context.close(),
    };
}

/** A persistent context needs a profile directory that it owns. */
function profileDir() {
    return process.env.E2E_PROFILE_DIR ?? mkdtempSync(join(tmpdir(), "paatti-e2e-profile-"));
}
