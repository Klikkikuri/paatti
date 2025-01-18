"use strict";

const log = (...args) => {
    console.log("popup:", ...args);
};

document.addEventListener("click", async (e) => {
    // TODO Explicitly ignore buttons not inside popup?


    // Perform actions according to clicked target.
    switch (e.target.id) {
        case "enabled":
            log("Local storage:", await browser.storage.local.get());

            // Get the active tab.
            const activeTabId = (await browser.tabs
                .query({ active: true, currentWindow: true }))[0].id;

            await browser.storage.local.set({ "enabled": e.target.checked });
            await browser.tabs.sendMessage(activeTabId, {
                command: e.target.checked
                    ? "replaceClickbaits"
                    : "restoreClickbaits",
            });
            break;
        case "open-settings":
            const settingsElem = document.querySelector("#settings");
            if (settingsElem
                .classList
                .contains("hidden")
            ) {
                settingsElem.classList.remove("hidden");
            } else {
                settingsElem.classList.add("hidden");
            }
            break;
    }
});

document.addEventListener("DOMContentLoaded", async (e) => {
    log("Setting up UI");
    // Load up current settings to UI.
    const isConversionEnabled = (await browser.storage.local.get("enabled"))["enabled"];
    log(isConversionEnabled);
    document.getElementById("enabled").checked = isConversionEnabled;
});
