import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { clampProbability } from '../../model.js';
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
    #unsubscribe = null;

    /** The stored probability, held so a failed save can put it back without a re-read. */
    #probability = 0;

    connectedCallback() {
        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);

        const input = this.querySelector('.easter-egg-probability');
        // Set here rather than in the markup: an interpolated template literal counts as a dynamic
        // innerHTML assignment, which add-on review rejects. SCALE stays the one source for the ceiling.
        input.max = String(SCALE);
        input.addEventListener('change', () => this.save(input));

        // Calls back at once with the stored probability, then only when it moves.
        this.#unsubscribe = onConfigValue(
            (config) => clampProbability(config.easterEggProbability),
            (probability) => {
                this.#probability = probability;
                this.show(input);
            }
        );
    }

    disconnectedCallback() {
        if (!this.#unsubscribe) return;

        this.#unsubscribe();
        this.#unsubscribe = null;
    }

    /**
     * Fill the field from the stored probability.
     *
     * @param {HTMLInputElement} input - The field to fill.
     */
    show(input) {
        // Never fight the person typing in the field.
        if (document.activeElement === input) return;

        input.value = String(Math.round(this.#probability * SCALE));
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
            this.show(input);

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
