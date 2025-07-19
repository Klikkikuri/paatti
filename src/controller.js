"use strict";

import { getLogger, browser, getCurrentTabHostname } from "./utils.js";
import { model, modelEvents } from "./model.js";

const log = getLogger("controller");

const _dispatchConversion = async () => {
    log("Dispatching conversion...");
    // Get the active tab.
    const activeTabId = (await browser().tabs
        .query({ active: true, currentWindow: true }))[0].id;
    await browser().tabs.sendMessage(activeTabId, { command: "convertClickbaits" });

    log("Conversion dispatch performed.");
};

const _setSiteEnabled = async (isEnabled, hostname) => {
    if (isEnabled) {
        // Turning on a site also turns on the extension.
        await model.write.setEnabled(true);
    } else {
        // Kerran cannot stay on when actively setting site to disabled.
        await model.write.setKerran(false, hostname);
    }

    await model.write.setEnabled(isEnabled, hostname);
};

/**
 * Namespace for __controller__ of model-view-controller.
 */
const controller = {
    initialize: async () => {
        await model.write.initialize();
        /* CONFIG: Configure your desired development thingies here. */
        if (await model.read.isDevelopmentEnv()) {
            await model.write.setEnabled(true, "www.iltalehti.fi");
        }
    },

    setEnabled: async (isEnabled) => {
        log("Turning paatti ", isEnabled ? "ON" : "OFF");
        await model.write.setEnabled(isEnabled);
    },

    setSiteEnabled: _setSiteEnabled,

    setCurrentTabEnabled: async (isEnabled) => {
        const currentTabHostname = await getCurrentTabHostname();
        await _setSiteEnabled(isEnabled, currentTabHostname)
    },

    setCurrentTabKerran: async (isKerran) => {
        const currentTabHostname = await getCurrentTabHostname();
        await model.write.setKerran(isKerran, currentTabHostname);
        // Set the enabled-flag also in order to actually trigger conversion
        // restore.
        await model.write.setEnabled(!isKerran, currentTabHostname);
    },

    dispatchConversion: _dispatchConversion,

    resetKerran: async (hostname) => {
        if (!(await model.read.isEnabled(hostname)) && (await model.read.isKerran(hostname))) {
            await model.write.setEnabled(true, hostname);
            await model.write.setKerran(false, hostname);
            log(`Resetted kerran for ${hostname}`);
        } else {
            log(`No need to reset kerran for ${hostname}`);
        }
    },

    updateStatistics: async ({ hostname, restoreTitleData, links }) => {
        const siteStats = {
            "titles": {
                "pageClickbaitsCount": restoreTitleData
                    ? Object.values(restoreTitleData)
                        .filter((x) => x.title !== undefined)
                        .length
                    : undefined,
                "labelNot": 0,
                "labelSlightly": 0,
                "labelVery": 0,
                "labelExtremely": 0,
            },
            "misc": {
                "linksCount": links.length,
            },
        };

        model.write.setStatistics(siteStats, { hostname });
    },
};

model.events.addEventListener(modelEvents.enabledChange, _dispatchConversion);

export { controller };
