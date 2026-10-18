"use strict";

/**
 * @file devserver-bootstrap.js
 * The background module of a copy that tools/devserver-stage.mjs stages; the paths are relative to that copy.
 *
 * On the first install, it does what the options page asks a person to do: it turns on loopback providers, adds and
 * refreshes the provider of `devserver.json`, and turns on the provider's site.
 */

import "./src/background.js";
import browser from "./src/browser-api.js";
import { getConfig } from "./src/config.js";
import { controller } from "./src/controller.js";
import { addProvider, refreshProviders } from "./src/providers.js";

const LOCALHOST_GRANT = "http://localhost/*";

browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== "install") return;
    const { manifestUrl } = await (await fetch(browser.runtime.getURL("devserver.json"))).json();

    // The install listener of background.js sets the environment.
    for (let i = 0; i < 50 && (await getConfig()).activeEnv !== "development"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!await browser.permissions.contains({ origins: [LOCALHOST_GRANT] })) {
        console.warn(`devserver: ${LOCALHOST_GRANT} is not granted. Grant it on the permissions page of the add-on.`);
    }

    await controller.setLoopbackProvidersEnabled(true);
    await addProvider(manifestUrl);
    await refreshProviders();
    await controller.setSiteEnabled(true, new URL(manifestUrl).hostname);
    console.log(`devserver: added the provider ${manifestUrl}`);
});
