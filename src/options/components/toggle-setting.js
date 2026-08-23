import { ComponentBase, emitSettingSaved } from './component-utils.js';
import './toggle-button.js';

/**
 * @file toggle-setting.js
 * Builds the boolean-setting elements: a labelled card with a <toggle-button>, in a
 * compact (popup) and a detailed (options) layout.
 *
 * Three settings differed only in which key they wrote, so they are configuration now
 * rather than three copies of the same 130 lines. The idiom is `createBadgeClass` in
 * src/components/badge-base.js.
 *
 * Both templates are substitution-free literals, so neither counts as a dynamic innerHTML
 * assignment; every varying string is written with textContent after cloning.
 */

const compactTemplate = document.createElement('template');
compactTemplate.innerHTML = `
    <span class="label-text" style="font-weight: bold;"></span>
    <toggle-button type="toggle"></toggle-button>
`;

const detailedTemplate = document.createElement('template');
detailedTemplate.innerHTML = `
    <div class="setting-group">
        <div class="setting-label">
            <div class="label-text">
                <strong class="title-text"></strong>
                <span class="description-text"></span>
            </div>
            <toggle-button></toggle-button>
        </div>
    </div>
`;

/**
 * @typedef {Object} ToggleSettingSpec
 * @property {(el: HTMLElement) => string} settingKey - `detail.key` on the setting-saved event.
 * @property {(el: HTMLElement) => {compact?: string, title?: string, description?: string}} labels
 *           Already-localized text. The element is passed because the instance carries the
 *           attribute that selects it -- title-modifier's `modifier`.
 * @property {(el: HTMLElement, apply: (checked: boolean) => void) => (() => void)|void} read
 *           Subscribe to the stored value; call apply() with it now and whenever it moves.
 *           Return an unsubscribe, or register teardowns on the element and return nothing.
 * @property {(el: HTMLElement, checked: boolean) => Promise<void>} write
 *           Persist. Throw to signal failure: the control reverts and success:false is emitted.
 * @property {(el: HTMLElement) => {compact?: string, detailed?: string}} [ids]
 *           id for the <toggle-button>, per layout.
 * @property {Object} [messages] - savedKey/savedFallback/errorKey/errorFallback for setting-saved.
 * @property {(el: HTMLElement, titleEl: HTMLElement) => void} [decorate]
 *           Detailed layout only, after the title is written. Used to append a badge preview.
 */

/**
 * Build the custom element class for a boolean setting.
 *
 * @param {ToggleSettingSpec} spec
 * @returns {typeof ComponentBase}
 */
export function createToggleSetting(spec) {
    return class extends ComponentBase {
        onConnect() {
            const compact = (this.getAttribute('layout') || 'detailed') === 'compact';
            const labels = spec.labels(this) || {};

            if (compact) {
                this.classList.add('compact-setting-row');
                this.replaceChildren(compactTemplate.content.cloneNode(true));
                this.querySelector('.label-text').textContent = labels.compact ?? '';
            } else {
                this.replaceChildren(detailedTemplate.content.cloneNode(true));

                const titleEl = this.querySelector('.title-text');
                titleEl.textContent = labels.title ?? '';
                spec.decorate?.(this, titleEl);

                this.querySelector('.description-text').textContent = labels.description ?? '';
            }

            const toggleBtn = this.querySelector('toggle-button');
            const id = spec.ids?.(this)?.[compact ? 'compact' : 'detailed'];
            if (id) toggleBtn.id = id;

            this.#wire(toggleBtn, compact);

            // Calls back at once with the stored state, then only when it moves.
            const unsubscribe = spec.read(this, (checked) => { toggleBtn.checked = checked; });
            if (unsubscribe) this.addTeardown(unsubscribe);
        }

        #wire(toggleBtn, compact) {
            // The whole card is a click target, but only where there is a card to click.
            const labelCard = this.querySelector('.setting-label');
            if (labelCard) {
                labelCard.addEventListener('click', (event) => {
                    if (event.target.closest('toggle-button')) return;
                    toggleBtn.toggle();
                }, { signal: this.signal });
            }

            toggleBtn.addEventListener('toggle-change', async (event) => {
                const { checked } = event.detail;
                const key = spec.settingKey(this);
                const messages = spec.messages || {};

                try {
                    await spec.write(this, checked);
                    // The popup has nowhere to show this; the options page does.
                    if (!compact) {
                        emitSettingSaved(this, {
                            key,
                            value: checked,
                            messageKey: messages.savedKey,
                            fallback: messages.savedFallback,
                        });
                    }
                } catch (error) {
                    console.error(`Failed to save ${key}:`, error);
                    toggleBtn.checked = !checked;
                    if (!compact) {
                        emitSettingSaved(this, {
                            key,
                            value: !checked,
                            success: false,
                            messageKey: messages.errorKey,
                            fallback: messages.errorFallback,
                        });
                    }
                }
            }, { signal: this.signal });
        }
    };
}
