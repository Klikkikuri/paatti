"use strict";

/**
 * First-run state and entry points of the setup wizard.
 *
 * Three flags live in `storage.sync`, so a choice follows the person to a second browser:
 * - `introCardClaimed`: the background script has handed the first-activation card to one page.
 * - `wizardDone`: the user finished or skipped the wizard.
 * - `wizardLineHidden`: the user hid the popup's "Set up" line.
 *
 * An expired or dismissed card sets none of the last two: it does not mean that the user saw the wizard.
 *
 * The content script does not import this module. It asks the background script, which owns the claim.
 */

import browser from "./browser-api.js";

const WIZARD_PATH = "src/options/welcome/welcome.html";

/** The lengths of the wizard. The deck of a mode is built in `options/welcome/deck.js`. */
export const WIZARD_MODES = Object.freeze(["quick", "tour"]);

/** Every claim runs after the one before it, so two pages that ask together cannot both read "not claimed". */
let claimChain = Promise.resolve();

/**
 * Hand out the first-activation card one time.
 *
 * @returns {Promise<boolean>} True for the first caller ever, false for every later one.
 */
export function claimIntroCard() {
    const claim = claimChain.then(async () => {
        const { introCardClaimed } = await browser.storage.sync.get("introCardClaimed");
        if (introCardClaimed === true) return false;

        await browser.storage.sync.set({ introCardClaimed: true });
        return true;
    });
    claimChain = claim.catch(() => {});

    return claim;
}

/** @returns {Promise<{wizardDone: boolean, wizardLineHidden: boolean}>} */
export async function readWizardState() {
    const { wizardDone, wizardLineHidden } = await browser.storage.sync.get(["wizardDone", "wizardLineHidden"]);
    return { wizardDone: wizardDone === true, wizardLineHidden: wizardLineHidden === true };
}

export const markWizardDone = () => browser.storage.sync.set({ wizardDone: true });

export const hideWizardLine = () => browser.storage.sync.set({ wizardLineHidden: true });

/**
 * The mode of an "open the wizard" message from a content script.
 *
 * Only a content script of this extension can ask, and it can name a mode but never an address: the page
 * that the content script runs in must not choose where the browser goes.
 *
 * @param {*} message
 * @param {{id?: string, tab?: object}} sender
 * @returns {string|null} A value of WIZARD_MODES, or null when the message is not acceptable.
 */
export function wizardModeOf(message, sender) {
    if (message?.action !== "openWizard") return null;
    if (sender?.id !== browser.runtime.id || !sender.tab) return null;

    return WIZARD_MODES.includes(message.mode) ? message.mode : null;
}

/**
 * Show the wizard in a tab, in the given mode. A wizard tab that is already open is reused, not doubled.
 *
 * @param {string} mode - A value of WIZARD_MODES.
 */
export async function openWizard(mode) {
    const base = browser.runtime.getURL(WIZARD_PATH);
    const url = `${base}?mode=${mode}`;

    const [open] = await browser.tabs.query({ url: `${base}*` });
    if (!open) {
        await browser.tabs.create({ url });
        return;
    }

    await browser.tabs.update(open.id, { url, active: true });
    await browser.windows?.update(open.windowId, { focused: true });
}
