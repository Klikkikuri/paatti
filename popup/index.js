"use strict";

document.addEventListener("click", async (e) => {
    // TODO Explicitly ignore buttons not inside popup?

    // Get the active tab.
    const tabs = await browser.tabs
        .query({ active: true, currentWindow: true });

    // Perform actions according to clicked target.
   switch (e.target.id) {
        case "enabled":
            console.log("LS contains:" + localStorage.getItem("enabled"));
            localStorage.setItem("enabled", e.target.checked);
            browser.tabs.sendMessage(tabs[0].id, {
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
