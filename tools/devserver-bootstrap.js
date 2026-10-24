"use strict";

/**
 * @file devserver-bootstrap.js
 * The background module of a copy that tools/devserver-stage.mjs stages; the paths are relative to that copy.
 *
 * On the first install, it does what the options page asks a person to do: it turns on loopback providers, adds and
 * refreshes the providers of `devserver.json`, and turns on the site of their host.
 */

import "./src/background.js";
import browser from "./src/browser-api.js";
import { getConfig } from "./src/config.js";
import { controller } from "./src/controller.js";
import { addProvider, refreshProviders } from "./src/providers.js";

const LOCALHOST_GRANT = "http://localhost/*";

browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== "install") return;
    const { manifestUrls } = await (await fetch(browser.runtime.getURL("devserver.json"))).json();

    // The install listener of background.js sets the environment.
    for (let i = 0; i < 50 && (await getConfig()).activeEnv !== "development"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if ((await getConfig()).activeEnv !== "development") {
        console.warn("devserver: the environment did not become development; add its providers on the options page");
        return;
    }
    if (!await browser.permissions.contains({ origins: [LOCALHOST_GRANT] })) {
        console.warn(`devserver: ${LOCALHOST_GRANT} is not granted. Grant it on the permissions page of the add-on.`);
    }

    await controller.setLoopbackProvidersEnabled(true);
    for (const manifestUrl of manifestUrls) await addProvider(manifestUrl);
    await refreshProviders();
    for (const hostname of new Set(manifestUrls.map((url) => new URL(url).hostname))) {
        await controller.setSiteEnabled(true, hostname);
    }
    console.log(`devserver: added the providers ${manifestUrls.join(", ")}`);
});
