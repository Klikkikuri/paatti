"use strict";

document.addEventListener("click", (e) => {
    console.log(e);
    browser.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
            if (e.target.id === "enabled") {
                browser.tabs.sendMessage(tabs[0].id, {
                    command: e.target.checked ? "replaceClickbaits" : "restoreClickbaits",
                });
            }
        });
});
