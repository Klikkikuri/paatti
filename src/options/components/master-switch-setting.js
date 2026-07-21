import { browser } from '../../utils.js';
import { controller } from '../../controller.js';
import { model } from '../../model.js';
import './toggle-button.js';

/**
 * Custom element managing the global extension on/off state (Master Switch / "Aktivoi Paatti").
 * Supports layout="compact" (popup settings list item) and layout="detailed" (options page).
 */
class MasterSwitchSetting extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        const layout = this.getAttribute('layout') || 'detailed';

        if (layout === 'compact') {
            this.style.display = 'flex';
            this.style.alignItems = 'center';
            this.style.justifyContent = 'space-between';
            this.style.padding = '5px 0';
            this.style.width = '100%';

            const labelText = browser().i18n.getMessage('settingsviewMasterSwitchLabel') || 'Aktivoi laajennus';
            this.innerHTML = `
                <span style="font-weight: bold;">${labelText}</span>
                <toggle-button type="toggle" id="settingsview-extension-enabled"></toggle-button>
            `;
        } else {
            this.innerHTML = `
                <div class="setting-group">
                    <div class="setting-label" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #f8f9fa; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                        <div class="label-text" style="flex: 1; margin-right: 15px; text-align: left;">
                            <strong style="display: block; margin-bottom: 5px; color: #333;">Aktivoi Paatti</strong>
                            <span style="font-size: 0.9em; color: #666;">Kun päällä, laajennus käsittelee klikkiotsikot määritetyillä sivustoilla</span>
                        </div>
                        <toggle-button id="extensionEnabled"></toggle-button>
                    </div>
                </div>
            `;
        }

        const toggleBtn = this.querySelector('toggle-button');
        this.loadState(toggleBtn, layout);

        // Auto-sync state when settings are changed elsewhere (e.g. from popup/options)
        this.storageListener = () => this.sync(toggleBtn);
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
    async sync(toggleBtn) {
        const isEnabled = await model.read.isEnabled();
        toggleBtn.checked = isEnabled;
    }

    /**
     * Perform initial state loading and event registration.
     */
    async loadState(toggleBtn, layout) {
        await this.sync(toggleBtn);

        const innerCheckbox = toggleBtn.querySelector('input');
        if (innerCheckbox) {
            innerCheckbox.id = layout === 'compact' ? 'settingsview-extension-enabled' : 'extensionEnabled';
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
                await controller.setEnabled(checked);
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: { key: 'extensionEnabled', value: checked, success: true, message: 'Laajennuksen tila tallennettu!' }
                    }));
                }
            } catch (err) {
                console.error('Failed to save master switch setting:', err);
                toggleBtn.checked = !checked;
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: { key: 'extensionEnabled', value: !checked, success: false, message: 'Virhe laajennuksen tilan tallentamisessa' }
                    }));
                }
            }
        });
    }
}

customElements.define('master-switch-setting', MasterSwitchSetting);
