"use strict";

const log = getLogger("background");

browser.runtime.onInstalled.addListener(async () => {
    await model.initialize()

    /* CONFIG: Configure your desired development thingies here. */
    if (await model.isDevelopmentEnv()) {
        await model.setEnabled(true, { hostname: "www.iltalehti.fi" });
    }

    log("Installed Paatti with initial configuration:", await model.toString());
});

// For every site load, perform the conversion as configured.
browser.tabs.onUpdated.addListener(async () => {
    log("Tab updated");
    await controller.runConversion();
});
