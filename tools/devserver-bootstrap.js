"use strict";

/**
 * @file devserver-bootstrap.js
 * The background module of a copy that tools/devserver-stage.mjs stages; the paths are relative to that copy.
 * Why the copy exists and what it installs: README.md, section "Development Server".
 *
 * On the first install, it does what a person does on the options page: it turns on loopback providers, adds and
 * refreshes the providers of `devserver.json`, and turns on the site of their host.
 */

import { environmentReady } from "./src/background.js";
import browser from "./src/browser-api.js";
import { controller } from "./src/controller.js";
import { addProvider, refreshProviders } from "./src/providers.js";

// Both grants the staged manifest requires; the check must name the same pair, or a 127.0.0.1-only grant passes.
const LOOPBACK_GRANTS = ["http://localhost/*", "http://127.0.0.1/*"];

browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== "install") return;
    const { manifestUrls } = await (await fetch(browser.runtime.getURL("devserver.json"))).json();

    // background.js's own install listener sets the environment; this promise settles when its write is done.
    const environment = await environmentReady;
    if (environment !== "development") {
        console.warn(`devserver: the environment is '${environment}'; add the providers on the options page`);
        return;
    }
    for (const origin of LOOPBACK_GRANTS) {
        if (!await browser.permissions.contains({ origins: [origin] })) {
            console.warn(`devserver: ${origin} is not granted. Grant it on the permissions page of the add-on.`);
        }
    }

    await controller.setLoopbackProvidersEnabled(true);
    for (const manifestUrl of manifestUrls) await addProvider(manifestUrl);
    await refreshProviders();
    for (const hostname of new Set(manifestUrls.map((url) => new URL(url).hostname))) {
        await controller.setSiteEnabled(true, hostname);
    }
    console.log(`devserver: added the providers ${manifestUrls.join(", ")}`);
});
