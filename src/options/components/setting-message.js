"use strict";

/**
 * @file setting-message.js
 * The payload of the `setting-saved` event, built without touching the DOM.
 *
 * Kept apart from the dispatch so `make test` can cover it: nothing under
 * src/options/components/ is otherwise reachable from the suites.
 */

import browser from "../../browser-api.js";

/** Used when a caller names no message of its own. */
const DEFAULTS = {
    success: { key: "settingSavedSuccess", fallback: "Setting saved!" },
    failure: { key: "settingSavedError", fallback: "Error saving setting" },
};

/**
 * Build the `detail` of a `setting-saved` event.
 *
 * The message is resolved here rather than by each caller, which is what the
 * `getMessage(...) || '...'` line repeated across the settings components was doing.
 *
 * @param {Object} detail
 * @param {string} detail.key - Identifies the setting to whoever renders the result.
 * @param {*} detail.value - The value now in effect; on failure, the reverted one.
 * @param {boolean} [detail.success=true] - Whether the write went through.
 * @param {string} [detail.messageKey] - i18n key overriding the default for this outcome.
 * @param {string} [detail.fallback] - Text for a missing translation; required with messageKey.
 * @returns {{key: string, value: *, success: boolean, message: string}}
 */
function settingSavedDetail({ key, value, success = true, messageKey, fallback }) {
    const preset = success ? DEFAULTS.success : DEFAULTS.failure;
    const resolvedKey = messageKey || preset.key;
    const resolvedFallback = messageKey ? (fallback ?? "") : preset.fallback;

    return {
        key,
        value,
        success,
        message: browser.i18n.getMessage(resolvedKey) || resolvedFallback,
    };
}

export { settingSavedDetail };
