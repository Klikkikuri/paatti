"use strict";

import { model } from "./model.js";

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
                return `🤖 ${title}`;
            }
            return title;
        }
    }
];

/**
 * Applies all active modifiers sequentially to the given title text.
 * @param {string} titleText - The title text to modify
 * @param {Object} rahtiEntry - The dataset entry
 * @returns {Promise<string>} The final modified title text
 */
async function applyModifiers(titleText, rahtiEntry) {
    let result = titleText;
    for (const modifier of titleModifiers) {
        try {
            if (await modifier.isEnabled()) {
                result = modifier.modify(result, rahtiEntry);
            }
        } catch (err) {
            console.error(`Error executing title modifier '${modifier.name}':`, err);
        }
    }
    return result;
}

export { applyModifiers, titleModifiers };
