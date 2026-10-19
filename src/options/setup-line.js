"use strict";

import { readWizardState, hideWizardLine, openWizard } from "../welcome-state.js";

/**
 * Offer the setup wizard in the popup, until the wizard is done or the user hides the offer.
 *
 * Hiding the line sets its own flag and not `wizardDone`: a user who hid the offer did not see the wizard.
 *
 * @param {HTMLElement} line - The element that holds the offer. It starts hidden.
 * @param {() => void} [close] - Closes the popup after a button opened the wizard tab.
 */
export async function initSetupLine(line, close = () => window.close()) {
    const { wizardDone, wizardLineHidden } = await readWizardState();
    if (wizardDone || wizardLineHidden) return;

    for (const mode of ["tour", "quick"]) {
        line.querySelector(`[data-mode="${mode}"]`).addEventListener("click", async () => {
            await openWizard(mode);
            close();
        });
    }
    line.querySelector("[data-hide]").addEventListener("click", async () => {
        await hideWizardLine();
        line.classList.add("hidden");
    });

    line.classList.remove("hidden");
}
