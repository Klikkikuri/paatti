"use strict";

import { model } from "./model.js";
import { browser } from "./utils.js";

const LABEL_AI_SLOP = "com.github.klikkikuri/ai-slop=true";

/**
 * List of registered title modifiers that run sequentially on news titles.
 */
const titleModifiers = [
    {
        name: "ai-slop",
        isEnabled: async () => await model.read.getMarkAiSlop(),
        modify: (title, entry) => {
            if (entry.labels && entry.labels.includes(LABEL_AI_SLOP)) {
                const tooltip = browser()?.i18n?.getMessage("modifierAiSlopTooltip") || "Sisältö on pääosin luotu tai käännetty tekoälyllä.";
                return {
                    text: title,
                    badgeText: "✨ ",
                    tooltip: tooltip
                };
            }
            return { text: title };
        }
    }
];

/**
 * Applies all active modifiers sequentially to the given title text.
 * @param {string} titleText - The title text to modify
 * @param {Object} rahtiEntry - The dataset entry
 * @returns {Promise<{text: string, badges: Array<{badgeText: string, tooltip?: string, className?: string}>}>} The modified title text and badges
 */
async function applyModifiers(titleText, rahtiEntry) {
    let currentText = titleText;
    const badges = [];

    for (const modifier of titleModifiers) {
        try {
            if (await modifier.isEnabled()) {
                const res = modifier.modify(currentText, rahtiEntry);
                if (typeof res === "string") {
                    currentText = res;
                } else if (res && typeof res === "object") {
                    if (res.text !== undefined) currentText = res.text;
                    if (res.badgeText) {
                        badges.push({
                            badgeText: res.badgeText,
                            tooltip: res.tooltip,
                            className: res.className || "klikkikuri-ai-badge"
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`Error executing title modifier '${modifier.name}':`, err);
        }
    }
    return { text: currentText, badges };
}

export { applyModifiers, titleModifiers };

