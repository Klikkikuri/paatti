"use strict";

/**
 * @file clickbait-constants.js
 * The clickbaitiness vocabulary that more than one world shares: the level names, the default conversion
 * threshold, and the paywall label.
 *
 * `src/model.js` carries the same level names in its `Clickbaitiness` class, but the content script loads
 * `model.js` through `runtime.getURL()` in the isolated world and cannot import it; the tools import this
 * module directly. Keep the two lists in step — both must match meri's backend levels.
 */

/** Levels of clickbaitiness, from least to most clickbaity. */
export const LEVELS = Object.freeze([
    "Not Clickbait at all",
    "Slightly Clickbaity",
    "Moderately Clickbaity",
    "Very Clickbaity",
    "Extremely Clickbaity"
]);

/** The conversion threshold a fresh install gets before the user moves the slider. */
export const DEFAULT_CLICKBAIT_LEVEL = 2;

/** The Rahti label that marks an entry as behind a paywall. */
export const LABEL_PAYWALLED = "com.github.klikkikuri/paywalled=true";
