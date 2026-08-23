"use strict";

import browser from "./browser-api.js";
import { getLogger, getCurrentTabHostname } from "./utils.js";
import { model } from "./model.js";

const log = getLogger("controller");

const _setSiteEnabled = async (isEnabled, hostname) => {
    if (isEnabled) {
        // Turning on a site also turns on the extension.
        await model.write.setEnabled(true);
    }

    await model.write.setEnabled(isEnabled, hostname);
    return true;
};

/**
 * Namespace for __controller__ of model-view-controller.
 */
const controller = {
    setEnabled: async (isEnabled) => {
        log("Turning paatti ", isEnabled ? "ON" : "OFF");
        await model.write.setEnabled(isEnabled);
    },

    setEnvironment: async (value) => {
        await model.write.setEnvironment(value);
    },

    setSiteEnabled: _setSiteEnabled,

    setClickbaitLevel: async (value) => {
        log(`Setting clickbait level to ${value}`);
        await model.write.setClickbaitLevel(value);
    },

    setDebugVisualsEnabled: async (value) => {
        log(`Setting debug visuals to ${value}`);
        await model.write.setDebugVisualsEnabled(value);
    },

    setEasterEggProbability: async (value) => {
        log(`Setting easter egg probability to ${value}`);
        await model.write.setEasterEggProbability(value);
    },

    setVisualHighlightEnabled: async (value) => {
        log(`Setting visual highlight to ${value}`);
        await model.write.setVisualHighlightEnabled(value);
    },

    setRefreshIntervalMinutes: async (value) => {
        log(`Setting refresh interval minutes to ${value}`);
        await model.write.setRefreshIntervalMinutes(value);
    },

    setDevTitleDataUrls: async (urls) => {
        log(`Setting development title data URLs:`, urls);
        await model.write.setDevTitleDataUrls(urls);
    },

    /**
     * Set a title modifier enabled or disabled.
     * @param {string} name - The modifier name (e.g. 'aiSlop').
     * @param {boolean} value - True if enabled, false otherwise.
     */
    setModifierEnabled: async (name, value) => {
        log(`Setting modifier '${name}' to ${value}`);
        await model.write.setModifierEnabled(name, value);
    },

    /**
     * Persist a page stats delta for a specific siteConfig domain.
     * @param {{ domain: string, delta: import('./stats.js').PageSnapshot }} params
     */
    updateStatistics: async ({ domain, delta }) => {
        await model.write.addStatistics(delta, { domain });
    },

    devmode: {
        dumpLinkSignatures: async () => {
            log("Generating dump of link signatures for the current page...");
            // Get the active tab.
            const tabs = browser.tabs;
            const activeTabId = (await tabs.query({ active: true, currentWindow: true }))[0].id;
            const result = await tabs.sendMessage(activeTabId, { command: "devmode_generateLinkSignatures" });

            log("Dumped.");
            return result;
        },

        setTitleDataUrl: async (url) => {
            log("Setting title data URL...");

            const tabs = browser.tabs;
            const activeTabId = (await tabs.query({ active: true, currentWindow: true }))[0].id;

            const currentTabHostname = await getCurrentTabHostname();

            // First restore the original state seen on page so that will not
            // mix the title data sources causing havoc visually.
            const originalEnabledState = await model.read.isEnabled(currentTabHostname);
            await _setSiteEnabled(false, currentTabHostname)
            await tabs.sendMessage(activeTabId, { command: "convertClickbaits" });

            await model.write.setTitleDataUrl(url);
            await tabs.sendMessage(activeTabId, { command: "convertClickbaits" });
            await _setSiteEnabled(originalEnabledState, currentTabHostname)

            log(`Title data URL set to ${url}`);
        },
    },
};


export { controller };

