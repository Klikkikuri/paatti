/**
 * @file browser.mjs
 * A persistent Chromium context with the staged extension, and the helpers that run the extension's own modules:
 * the options page does the adds and the refreshes; everything here drives code loaded from the extension URL.
 *
 * The tests drive a real Chromium. A `page.evaluate` callback reaches the extension API through the repository's
 * own import — `const { default: browser } = await import("/src/browser-api.js")` — as src/ does, so the suite
 * carries no second definition of the namespace.
 */

import { chromium } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADD_PROVIDER = async (manifestUrl) => {
    // The install handler writes the environment. Wait for the stored value, not for a promise from a module:
    // a page import of background.js makes a second instance whose onInstalled listener never fires, and a
    // restarted MV3 worker does not fire one either. Storage is the one signal that survives both.
    //
    // This function is serialized into the page, so it can use nothing from this module: the namespace and the
    // wait are both inline. The repository's browser-api resolves Chromium's namespace for every version.
    const { default: browser } = await import("/src/browser-api.js");
    const deadline = Date.now() + 15000;
    for (;;) {
        const { userPreferences } = await browser.storage.local.get("userPreferences");
        if (userPreferences?.environment === "development") break;
        if (Date.now() > deadline) {
            throw new Error(`the environment is '${userPreferences?.environment ?? "nothing"}', expected 'development'`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const { controller } = await import("/src/controller.js");
    const { addProvider, refreshProviders } = await import("/src/providers.js");
    await controller.setLoopbackProvidersEnabled(true);
    await addProvider(manifestUrl);
    await refreshProviders();
    await controller.setSiteEnabled(true, "localhost");
    const { getConfig } = await import("/src/config.js");
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
    // A provider that has not finished its first refresh has no siteConfigs yet: the record starts empty.
    return data && { errors: data.errors, rejected: data.rejected, entryCount: data.entryCount,
                     updated: data.updated, checked: data.checked, sites: Object.keys(data.siteConfigs ?? {}),
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
 * Launches Chromium with the staged extension, and returns the helpers once the service worker is up. One
 * extension page stays open for the life of the browser; every `run` evaluates on it.
 *
 * @param {string} extensionDir - The staged extension's directory.
 * @returns {Promise<PaattiBrowser>}
 */
export async function launch(extensionDir) {
    // E2E_PROFILE_DIR keeps the profile for a debugging session; otherwise this call owns the directory and
    // removes it on close.
    const externalProfile = process.env.E2E_PROFILE_DIR;
    const profile = externalProfile ?? mkdtempSync(join(tmpdir(), "paatti-e2e-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
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

    let extensionPage;
    const page = async () => {
        if (!extensionPage || extensionPage.isClosed()) {
            extensionPage = await context.newPage();
            await extensionPage.goto(`chrome-extension://${extensionId}/src/options/index.html`);
        }
        return extensionPage;
    };
    const run = async (script, arg) => page().then((p) => p.evaluate(script, arg));

    return {
        context,
        extensionId,
        run,
        addProvider: (manifestUrl) => run(ADD_PROVIDER, manifestUrl),
        refresh: () => run(REFRESH),
        providerData: (manifestUrl) => run(PROVIDER_DATA, manifestUrl),
        newPage: () => context.newPage(),
        close: async () => {
            await extensionPage?.close().catch(() => {});
            await context.close();
            if (!externalProfile) rmSync(profile, { recursive: true, force: true });
        },
    };
}
