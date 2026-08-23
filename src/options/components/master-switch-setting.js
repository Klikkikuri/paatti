import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { localizeDocument } from '../utils.js';
import './toggle-button.js';
import { ComponentBase, defineComponent } from './component-utils.js';

const compactTemplate = document.createElement('template');
compactTemplate.innerHTML = `
    <span class="label-text" style="font-weight: bold;"></span>
    <toggle-button type="toggle" id="settingsview-extension-enabled"></toggle-button>
`;

const detailedTemplate = document.createElement('template');
detailedTemplate.innerHTML = `
    <div class="setting-group">
        <div class="setting-label">
            <div class="label-text">
                <strong data-i18n="masterSwitchTitle">Activate Paatti</strong>
                <span data-i18n="masterSwitchDesc">When enabled, the extension processes clickbait headlines on configured sites</span>
            </div>
            <toggle-button id="extensionEnabled"></toggle-button>
        </div>
    </div>
`;

/**
 * Custom element managing the global extension on/off state (Master Switch / "Aktivoi Paatti").
 * Supports layout="compact" (popup settings list item) and layout="detailed" (options page).
 */
class MasterSwitchSetting extends ComponentBase {

    onConnect() {
        const layout = this.getAttribute('layout') || 'detailed';

        if (layout === 'compact') {
            this.classList.add('compact-setting-row');
            this.replaceChildren(compactTemplate.content.cloneNode(true));

            const labelText = browser.i18n.getMessage('settingsviewMasterSwitchLabel') || 'Activate Paatti';
            const labelEl = this.querySelector('.label-text');
            if (labelEl) {
                labelEl.textContent = labelText;
            }
        } else {
            this.replaceChildren(detailedTemplate.content.cloneNode(true));
            localizeDocument(this);
        }

        const toggleBtn = this.querySelector('toggle-button');
        this.loadState(toggleBtn, layout);

        // Calls back at once with the stored state, then only when it moves.
        this.addTeardown(onConfigValue(
            (config) => config.enabled,
            (enabled) => { toggleBtn.checked = enabled; }
        ));
    }

    /**
     * Wire up the control. The checked state itself arrives from onConfigValue.
     */
    loadState(toggleBtn, layout) {
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
            }, { signal: this.signal });
        }

        toggleBtn.addEventListener('toggle-change', async (e) => {
            const checked = e.detail.checked;
            try {
                await controller.setEnabled(checked);
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: {
                            key: 'extensionEnabled',
                            value: checked,
                            success: true,
                            message: browser.i18n.getMessage('masterSwitchSaved') || 'Extension status saved!'
                        }
                    }));
                }
            } catch (err) {
                console.error('Failed to save master switch setting:', err);
                toggleBtn.checked = !checked;
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: {
                            key: 'extensionEnabled',
                            value: !checked,
                            success: false,
                            message: browser.i18n.getMessage('masterSwitchSaveError') || 'Error saving extension status'
                        }
                    }));
                }
            }
        }, { signal: this.signal });
    }
}

defineComponent('master-switch-setting', MasterSwitchSetting);
