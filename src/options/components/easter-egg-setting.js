import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { model } from '../../model.js';
import { affectsEasterEgg } from '../easter-egg.js';
import { localizeDocument } from '../utils.js';

/* The stored value is a fraction; the input works in whole percent, because that
 * is what a person testing the easter egg wants to type. */
const SCALE = 100;

const template = document.createElement('template');
template.innerHTML = `
    <div class="setting-group">
        <label class="setting-label">
            <div class="label-text">
                <strong data-i18n="devmodeEasterEggTitle">Easter egg chance</strong>
                <span data-i18n="devmodeEasterEggDesc">How often the hidden artwork joins the page background</span>
            </div>
            <span style="display: flex; align-items: center; gap: 6px;">
                <input type="number" class="easter-egg-probability" id="easterEggProbability" min="0" step="1"
                       style="width: 80px; padding: 8px; border: 2px solid var(--color-border); border-radius: 6px; font-size: 1em; text-align: center;">
                <span>%</span>
            </span>
        </label>
    </div>
`;

/**
 * Custom element managing the easter egg probability, a development-only control
 * on the options page.
 *
 * 0 never shows the artwork and 100 always does, so the input doubles as the
 * on/off switch needed to look at it.
 */
class EasterEggSetting extends HTMLElement {
    #storageListener = null;

    /** Bumped per sync, so an earlier read that resolves late cannot win. */
    #generation = 0;

    connectedCallback() {
        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);

        const input = this.querySelector('.easter-egg-probability');
        // Set here rather than in the markup: an interpolated template literal counts as a dynamic
        // innerHTML assignment, which add-on review rejects. SCALE stays the one source for the ceiling.
        input.max = String(SCALE);
        input.addEventListener('change', () => this.save(input));

        this.sync(input);

        // Filtered: statistics are written constantly, and re-reading config on every one
        // of those writes would both waste the read and fight anyone using the field.
        this.#storageListener = (changes, areaName) => {
            if (!affectsEasterEgg(changes, areaName)) return;
            this.sync(input);
        };
        browser.storage.onChanged.addListener(this.#storageListener);
    }

    disconnectedCallback() {
        if (!this.#storageListener) return;

        browser.storage.onChanged.removeListener(this.#storageListener);
        this.#storageListener = null;
    }

    /**
     * Show the probability now in storage.
     *
     * @param {HTMLInputElement} input - The field to fill.
     */
    sync(input) {
        const generation = ++this.#generation;

        model.read.getEasterEggProbability().then((probability) => {
            // A later sync has overtaken this one, or the element has left the page
            // while the read was in flight.
            if (generation !== this.#generation || !this.isConnected) return;

            // Never fight the person typing in the field.
            if (document.activeElement === input) return;

            input.value = String(Math.round(probability * SCALE));
        }).catch((error) => console.error('Failed to read easter egg probability:', error));
    }

    /**
     * Store what the field now holds, and say on the page how that went.
     *
     * @param {HTMLInputElement} input - The field that changed.
     */
    async save(input) {
        // A blank or out-of-range field would otherwise store NaN.
        const percent = Math.min(Math.max(Number(input.value) || 0, 0), SCALE);
        input.value = String(percent);

        const detail = { key: 'easterEggProbability', value: percent / SCALE };

        try {
            await controller.setEasterEggProbability(percent / SCALE);
            this.dispatchEvent(new CustomEvent('setting-saved', {
                bubbles: true,
                detail: {
                    ...detail,
                    success: true,
                    message: browser.i18n.getMessage('settingSavedSuccess') || 'Setting saved!'
                }
            }));
        } catch (err) {
            console.error('Failed to save easter egg probability:', err);

            // Put back what is actually stored, so the field never shows a value that
            // did not survive the write.
            this.sync(input);

            this.dispatchEvent(new CustomEvent('setting-saved', {
                bubbles: true,
                detail: {
                    ...detail,
                    success: false,
                    message: browser.i18n.getMessage('settingSavedError') || 'Error saving setting'
                }
            }));
        }
    }
}

customElements.define('easter-egg-setting', EasterEggSetting);
