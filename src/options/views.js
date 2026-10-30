/**
 * @file views.js
 * The popup view vocabulary: the selectors that find each view's container and the label key of each view.
 *
 * A view container is found by its `data-view` attribute, not by a styling class, so a class rename
 * cannot make `showView` toggle the wrong element. The guard test in `tests/popup-views.test.mjs`
 * asserts that each selector matches exactly one container in `popup.html`, and that the markup
 * declares exactly these views.
 */

/** Maps each view name to the selector of its container. */
export const VIEW_SELECTORS = {
    "main": "[data-view=\"main\"]",
    "stats": "[data-view=\"stats\"]",
    "feedback": "[data-view=\"feedback\"]",
    "settings": "[data-view=\"settings\"]",
};

/** Maps each view name to the i18n key of the tab indicator label. */
export const VIEW_LABELS = {
    "main": "navigationMainLabel",
    "stats": "navigationStatsLabel",
    "feedback": "navigationFeedbackLabel",
    "settings": "navigationSettingsLabel",
};
