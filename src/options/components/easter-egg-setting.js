import { browser } from '../../utils.js';
import { controller } from '../../controller.js';
import { model } from '../../model.js';
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
                <input type="number" class="easter-egg-probability" id="easterEggProbability" min="0" max="${SCALE}" step="1"
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
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);

        const input = this.querySelector('.easter-egg-probability');
        this.loadState(input);

        // Auto-sync state when settings are changed elsewhere
        this.storageListener = () => this.sync(input);
        browser().storage.onChanged.addListener(this.storageListener);
    }

    disconnectedCallback() {
        if (this.storageListener) {
            browser().storage.onChanged.removeListener(this.storageListener);
        }
    }

    /**
     * Fetch and apply latest values.
     */
    async sync(input) {
        // Never fight the person typing in the field.
        if (document.activeElement === input) return;

        input.value = String(Math.round((await model.read.getEasterEggProbability()) * SCALE));
    }

    /**
     * Perform initial state loading and event registration.
     */
    async loadState(input) {
        await this.sync(input);

        input.addEventListener('change', async () => {
            // A blank or out-of-range field would otherwise store NaN.
            const percent = Math.min(Math.max(Number(input.value) || 0, 0), SCALE);
            input.value = String(percent);

            try {
                await controller.setEasterEggProbability(percent / SCALE);
                this.dispatchEvent(new CustomEvent('setting-saved', {
                    bubbles: true,
                    detail: {
                        key: 'easterEggProbability',
                        value: percent / SCALE,
                        success: true,
                        message: browser().i18n.getMessage('settingSavedSuccess') || 'Setting saved!'
                    }
                }));
            } catch (err) {
                console.error('Failed to save easter egg probability:', err);
                await this.sync(input);
                this.dispatchEvent(new CustomEvent('setting-saved', {
                    bubbles: true,
                    detail: {
                        key: 'easterEggProbability',
                        value: percent / SCALE,
                        success: false,
                        message: browser().i18n.getMessage('settingSavedError') || 'Error saving setting'
                    }
                }));
            }
        });
    }
}

customElements.define('easter-egg-setting', EasterEggSetting);
