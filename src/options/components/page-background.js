import browser from '../../browser-api.js';
import { getLogger } from '../../utils.js';
import { model } from '../../model.js';
import { shouldShowEasterEgg, affectsEasterEgg, dayKey, unitHash, specialDayMessageKey } from '../easter-egg.js';
import { adoptComponentStyleSheet } from './component-utils.js';

// None of this element's CSS is shared, so it travels with the component: a page
// gets the styling by importing this module and nothing more.
adoptComponentStyleSheet(new URL('./page-background.css', import.meta.url));

const log = getLogger('components/page-background');

/** Class page-background.css hangs the easter egg artwork off. */
const EGG_CLASS = 'has-easter-egg';

/**
 * Custom element that carries the page artwork: the sea photo for the active
 * theme, the scrim that keeps text on top of it readable, and the easter egg
 * that occasionally joins them.
 *
 * The element paints behind the page and holds no content of its own, so a page
 * only has to place it; how it looks on that page is settled in the stylesheet
 * beside this module. The host page owes the element a stacking context -- see
 * the requirements at the top of page-background.css.
 */
class PageBackground extends HTMLElement {
    #storageListener = null;

    /** Bumped per apply, so an earlier read that resolves late cannot win. */
    #generation = 0;

    connectedCallback() {
        // Decoration only: nothing here belongs in the accessibility tree.
        this.setAttribute('aria-hidden', 'true');

        this.applyEasterEgg();

        this.#storageListener = (changes, areaName) => {
            if (!affectsEasterEgg(changes, areaName)) return;
            this.applyEasterEgg();
        };
        browser.storage.onChanged.addListener(this.#storageListener);
    }

    disconnectedCallback() {
        if (!this.#storageListener) return;

        browser.storage.onChanged.removeListener(this.#storageListener);
        this.#storageListener = null;
    }

    /**
     * Show or hide the easter egg for the probability now in storage.
     *
     * The roll is derived, not thrown: the day and the install's salt hash to one
     * number that holds for the whole day, so every page load that day settles the
     * same way. A change of probability then moves the bar against a standing
     * number, so raising the odds can reveal a sighting but never clear one off
     * the screen.
     *
     * A theme switch needs no work of its own: each theme names its own artwork,
     * so the result of the roll simply changes shape.
     */
    applyEasterEgg() {
        const generation = ++this.#generation;

        // A page left open over midnight picks up the new day on its next apply.
        const today = new Date();

        // Both reads are started here and awaited together. Starting one and
        // awaiting it first would push the getConfig() that registers the cache
        // invalidator behind the listener in connectedCallback.
        Promise.all([
            model.read.getEasterEggProbability(),
            model.read.getEasterEggSalt()
        ]).then(([probability, salt]) => {
            // A later apply has overtaken this one, or the element has left the
            // page while the read was in flight.
            if (generation !== this.#generation || !this.isConnected) return;

            const roll = unitHash(`${salt}:${dayKey(today)}`);
            const shown = specialDayMessageKey(today) !== null
                || shouldShowEasterEgg({ probability, roll });

            this.classList.toggle(EGG_CLASS, shown);
        }).catch((error) => log('Could not read the easter egg settings:', error));
    }
}

if (!customElements.get('page-background')) {
    customElements.define('page-background', PageBackground);
}
