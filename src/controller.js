"use strict";

import { getLogger } from "./utils.js";
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

    acknowledgeClickbaitLevelWarning: async () => {
        await model.write.acknowledgeClickbaitLevelWarning();
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

    setProviderShadowingEnabled: async (value) => {
        log(`Setting provider shadowing to ${value}`);
        await model.write.setProviderShadowingEnabled(value);
    },

    setLoopbackProvidersEnabled: async (value) => {
        log(`Setting loopback providers to ${value}`);
        await model.write.setLoopbackProvidersEnabled(value);
    },

    setRefreshIntervalMinutes: async (value) => {
        log(`Setting refresh interval minutes to ${value}`);
        await model.write.setRefreshIntervalMinutes(value);
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

    /** Wipe the cumulative statistics of every site. */
    resetStatistics: async () => {
        log("Resetting statistics");
        await model.write.resetStatistics();
    },
};


export { controller };

