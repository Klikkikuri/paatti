import { browser } from '../../utils.js';
import { model } from '../../model.js';
import { shouldShowEasterEgg } from '../easter-egg.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Class components.css hangs the easter egg artwork off. */
const EGG_CLASS = 'has-meerman';

/**
 * Custom element that carries the page artwork: the sea photo for the active
 * theme, the scrim that keeps text on top of it readable, and the easter egg
 * that occasionally joins them.
 *
 * The element paints behind the page and holds no content of its own, so the
 * host page only has to place it and say which scrim it wants -- see
 * `page-background` in components.css and the per-page rules that extend it.
 */
class PageBackground extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
        this.darkQuery = null;
        this.themeListener = null;
        this.lastProbability = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        // Decoration only: nothing here belongs in the accessibility tree.
        this.setAttribute('aria-hidden', 'true');

        this.darkQuery = window.matchMedia ? window.matchMedia(DARK_QUERY) : null;

        // A theme switch decides whether the easter egg can be seen at all, so roll again.
        this.themeListener = () => this.rollEasterEgg();
        this.darkQuery?.addEventListener('change', this.themeListener);

        // Re-roll when the development slider moves, so that control gives immediate
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
        if (this.themeListener) {
            this.darkQuery?.removeEventListener('change', this.themeListener);
        }
    }

    /**
     * Roll the dice once and show or hide the easter egg accordingly.
     */
    async rollEasterEgg() {
        const probability = await model.read.getEasterEggProbability();
        this.lastProbability = probability;

        const isDark = this.darkQuery?.matches ?? false;
        const show = shouldShowEasterEgg({ isDark, probability, roll: Math.random() });
        this.classList.toggle(EGG_CLASS, show);
    }
}

customElements.define('page-background', PageBackground);
