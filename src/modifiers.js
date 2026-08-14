"use strict";

import { model } from "./model.js";
import { browser } from "./utils.js";

const LABEL_AI_SLOP = "com.github.klikkikuri/ai-slop=true";
const LABEL_VIDEO = "com.github.klikkikuri/type=video";

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
                const label = browser()?.i18n?.getMessage("modifierAiSlopLabel") || "AI";
                return {
                    text: title,
                    tagName: "klikkikuri-ai-badge",
                    badgeText: label,
                    tooltip: tooltip
                };
            }
            return { text: title };
        }
    },
    {
        name: "video",
        isEnabled: async () => await model.read.getMarkVideo(),
        /**
         * Adds a video badge to the title if the entry is labelled as primarily video content.
         * @param {string} title
         * @param {Object} entry - The rahti data entry
         */
        modify: (title, entry) => {
            if (entry.labels && entry.labels.includes(LABEL_VIDEO)) {
                const tooltip = browser()?.i18n?.getMessage("modifierVideoTooltip") || "This link is mostly video rather than a written article.";
                const label = browser()?.i18n?.getMessage("modifierVideoLabel") || "Video";
                return {
                    text: title,
                    tagName: "klikkikuri-video-badge",
                    badgeText: label,
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
 * @returns {Promise<{text: string, badges: Array<{tagName: string, badgeText?: string, tooltip?: string, className?: string}>}>} The modified title text and badges
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
                    if (res.tagName) {
                        badges.push({
                            tagName: res.tagName,
                            badgeText: res.badgeText,
                            tooltip: res.tooltip
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

