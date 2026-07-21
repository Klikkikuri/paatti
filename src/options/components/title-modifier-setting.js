import { browser } from '../../utils.js';
import { controller } from '../../controller.js';
import { getConfig } from '../../config.js';
import './toggle-button.js';

/**
 * Custom element managing title modifier options (e.g. Tekoälymerkintä / AI Slop).
 * Supports layout="compact" (popup setting) and layout="detailed" (options page).
 */
class TitleModifierSetting extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        const modifier = this.getAttribute('modifier') || 'aiSlop';
        const layout = this.getAttribute('layout') || 'detailed';

        if (layout === 'compact') {
            this.style.display = 'flex';
            this.style.alignItems = 'center';
            this.style.justifyContent = 'space-between';
            this.style.padding = '5px 0';
            this.style.width = '100%';

            let labelText = 'Merkitse tekoälysisältö';
            if (modifier === 'aiSlop') {
                labelText = 'Tekoälymerkintä';
            }

            this.innerHTML = `
                <span style="font-weight: bold;">${labelText}</span>
                <toggle-button type="toggle" id="modifier-${modifier}"></toggle-button>
            `;
        } else {
            let title = 'Tekoälymerkintä (AI)';
            let description = 'Lisää robotti-ilmaisimen 🤖 otsikoihin, jotka on tunnistettu automaattisesti luoduksi tekoälysisällöksi';

            if (modifier === 'aiSlop') {
                title = '🤖 Tekoälymerkintä (AI)';
                description = 'Lisää robotti-ilmaisimen 🤖 otsikoihin, jotka on tunnistettu automaattisesti luoduksi tekoälysisällöksi';
            }

            this.innerHTML = `
                <div class="setting-group">
                    <div class="setting-label">
                        <div class="label-text" style="flex: 1; margin-right: 15px; text-align: left;">
                            <strong style="display: block; margin-bottom: 5px; color: #333;">${title}</strong>
                            <span style="font-size: 0.9em; color: #666;">${description}</span>
                        </div>
                        <toggle-button id="modifier-${modifier}"></toggle-button>
                    </div>
                </div>
            `;
        }

        const toggleBtn = this.querySelector('toggle-button');
        this.loadState(toggleBtn, modifier, layout);

        // Auto-sync state when settings are changed elsewhere
        this.storageListener = () => this.sync(toggleBtn, modifier);
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
    async sync(toggleBtn, modifier) {
        const config = await getConfig();
        const isEnabled = config.modifiers?.[modifier] || false;
        toggleBtn.checked = isEnabled;
    }

    /**
     * Perform initial state loading and event registration.
     */
    async loadState(toggleBtn, modifier, layout) {
        await this.sync(toggleBtn, modifier);

        const innerCheckbox = toggleBtn.querySelector('input');
        if (innerCheckbox) {
            innerCheckbox.id = `modifier-${modifier}-input`;
            if (layout === 'compact') {
                innerCheckbox.classList.add('toggle');
            } else {
                innerCheckbox.classList.add('conversion-switch');
            }
        }

        // Handle clicking anywhere in the card (layout !== 'compact')
        const labelCard = this.querySelector('.setting-label');
        if (labelCard && layout !== 'compact') {
            labelCard.addEventListener('click', (e) => {
                if (e.target.closest('toggle-button')) return;
                toggleBtn.checked = !toggleBtn.checked;
                toggleBtn.dispatchEvent(new CustomEvent('toggle-change', {
                    bubbles: true,
                    detail: { checked: toggleBtn.checked }
                }));
            });
        }

        toggleBtn.addEventListener('toggle-change', async (e) => {
            const checked = e.detail.checked;
            try {
                await controller.setModifierEnabled(modifier, checked);
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: { key: `modifier-${modifier}`, value: checked, success: true, message: 'Asetus tallennettu!' }
                    }));
                }
            } catch (err) {
                console.error(`Failed to save title modifier ${modifier}:`, err);
                toggleBtn.checked = !checked;
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: { key: `modifier-${modifier}`, value: !checked, success: false, message: 'Virhe asetuksen tallentamisessa' }
                    }));
                }
            }
        });
    }
}

customElements.define('title-modifier-setting', TitleModifierSetting);
