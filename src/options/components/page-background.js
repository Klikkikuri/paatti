import { browser, getLogger } from '../../utils.js';
import { model } from '../../model.js';
import { shouldShowEasterEgg } from '../easter-egg.js';
import { adoptComponentStyleSheet } from './component-utils.js';

// None of this element's CSS is shared, so it travels with the component: a page
// gets the styling by importing this module and nothing more.
adoptComponentStyleSheet(new URL('./page-background.css', import.meta.url));

const log = getLogger('components/page-background');

/** Class page-background.css hangs the easter egg artwork off. */
const EGG_CLASS = 'has-easter-egg';

/**
 * Does this storage change carry a new easter egg probability?
 *
 * The value is merged from two places by getConfig(): the sync environmentConfigs
 * the setter writes to, and the local userPreferences, which both overrides it and
 * names the environment to read it from. Everything else -- statistics above all,
 * which are written constantly -- is none of this element's business.
 *
 * @param {Object} changes - chrome.storage.onChanged changes.
 * @param {string} areaName - Storage area the change came from.
 * @returns {boolean}
 */
function affectsEasterEgg(changes, areaName) {
    if (areaName === 'sync') return Boolean(changes.environmentConfigs);
    if (areaName === 'local') return Boolean(changes.userPreferences);

    return false;
}

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
    /**
     * The die, drawn once when the element is created and held for its life. A
     * change of probability then moves the bar rather than throwing new dice, so
     * raising the odds can only ever reveal a sighting, never clear one off the
     * screen. Rolling here rather than on connect keeps that true across a
     * detach and re-attach, which calls connectedCallback a second time.
     */
    #roll = Math.random();

    #storageListener = null;

    /** Bumped per apply, so an earlier read that resolves late cannot win. */
    #generation = 0;

    connectedCallback() {
        // Decoration only: nothing here belongs in the accessibility tree.
        this.setAttribute('aria-hidden', 'true');

        // Read before subscribing. The first getConfig() registers the cache
        // invalidator in config.js, which must sit ahead of the listener below --
        // storage listeners run in registration order, and one that runs first
        // reads a cache nobody has invalidated yet.
        this.applyEasterEgg();

        this.#storageListener = (changes, areaName) => {
            if (!affectsEasterEgg(changes, areaName)) return;
            this.applyEasterEgg();
        };
        browser().storage.onChanged.addListener(this.#storageListener);
    }

    disconnectedCallback() {
        if (!this.#storageListener) return;

        browser().storage.onChanged.removeListener(this.#storageListener);
        this.#storageListener = null;
    }

    /**
     * Show or hide the easter egg for the probability now in storage. The die is
     * the one drawn at construction, so calling this twice over on an unchanged
     * probability settles on the same answer.
     *
     * A theme switch needs no work of its own: each theme names its own artwork,
     * so the result of the standing roll simply changes shape.
     */
    applyEasterEgg() {
        const generation = ++this.#generation;

        model.read.getEasterEggProbability().then((probability) => {
            // A later apply has overtaken this one, or the element has left the
            // page while the read was in flight.
            if (generation !== this.#generation || !this.isConnected) return;

            this.classList.toggle(EGG_CLASS, shouldShowEasterEgg({ probability, roll: this.#roll }));
        }).catch((error) => log('Could not read the easter egg probability:', error));
    }
}

if (!customElements.get('page-background')) {
    customElements.define('page-background', PageBackground);
}
