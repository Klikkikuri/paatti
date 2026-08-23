import { browser } from '../../utils.js';
import { model } from '../../model.js';
import { shouldShowEasterEgg } from '../easter-egg.js';
import { adoptComponentStyleSheet } from './component-utils.js';

// None of this element's CSS is shared, so it travels with the component: a page
// gets the styling by importing this module and nothing more.
adoptComponentStyleSheet(new URL('./page-background.css', import.meta.url));

/** Class page-background.css hangs the easter egg artwork off. */
const EGG_CLASS = 'has-easter-egg';

/**
 * Custom element that carries the page artwork: the sea photo for the active
 * theme, the scrim that keeps text on top of it readable, and the easter egg
 * that occasionally joins them.
 *
 * The element paints behind the page and holds no content of its own, so a page
 * only has to place it; how it looks on that page is settled in the stylesheet
 * beside this module.
 */
class PageBackground extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
        this.lastProbability = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        // Decoration only: nothing here belongs in the accessibility tree.
        this.setAttribute('aria-hidden', 'true');

        // Re-roll when the development field changes, so that control gives immediate
        // feedback. Other preference writes must not disturb a sighting on screen.
        this.storageListener = async () => {
            const probability = await model.read.getEasterEggProbability();
            if (probability === this.lastProbability) return;
            await this.rollEasterEgg();
        };
        browser().storage.onChanged.addListener(this.storageListener);

        this.rollEasterEgg();
    }

    disconnectedCallback() {
        if (this.storageListener) {
            browser().storage.onChanged.removeListener(this.storageListener);
        }
    }

    /**
     * Roll the dice once and show or hide the easter egg accordingly. A theme
     * switch needs no roll of its own: each theme names its own artwork, so the
     * result of this one roll simply changes shape.
     */
    async rollEasterEgg() {
        const probability = await model.read.getEasterEggProbability();
        this.lastProbability = probability;

        this.classList.toggle(EGG_CLASS, shouldShowEasterEgg({ probability, roll: Math.random() }));
    }
}

customElements.define('page-background', PageBackground);
