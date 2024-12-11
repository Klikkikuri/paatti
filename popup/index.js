"use strict";

document.addEventListener("click", (e) => {
    console.log(e);
    browser.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
            switch (e.target.id) {
                case "enabled":
                    browser.tabs.sendMessage(tabs[0].id, {
                        command: e.target.checked ? "replaceClickbaits" : "restoreClickbaits",
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
});
