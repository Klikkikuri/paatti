"use strict";

const log = getLogger("background");

browser.runtime.onInstalled.addListener(async () => {
    await controller.initialize()
    log("Installed Paatti with initial configuration:", await model.read.toString());
});

// For every site load, perform the conversion as configured.
browser.tabs.onUpdated.addListener(async () => {
    log("Tab updated");
    await controller.dispatchConversion();
});
