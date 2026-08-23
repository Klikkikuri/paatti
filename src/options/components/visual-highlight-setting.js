import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { model } from '../../model.js';
import { localizeDocument } from '../utils.js';
import './toggle-button.js';
import { ComponentBase, defineComponent } from './component-utils.js';

const compactTemplate = document.createElement('template');
compactTemplate.innerHTML = `
    <span class="label-text" style="font-weight: bold;"></span>
    <toggle-button type="toggle" id="devmode-setDebugVisuals"></toggle-button>
`;

const detailedTemplate = document.createElement('template');
detailedTemplate.innerHTML = `
    <div class="setting-group">
        <div class="setting-label">
            <div class="label-text">
                <strong data-i18n="devmodeVisualHighlightTitle">Visual Highlight</strong>
                <span data-i18n="devmodeVisualHighlightDesc">Show visual debug indicators on processed elements</span>
            </div>
            <toggle-button id="debugVisuals"></toggle-button>
        </div>
    </div>
`;

/**
 * Custom element managing the Visual Highlight / Debug Visuals setting.
 * Supports layout="compact" (popup settings list item) and layout="detailed" (options page).
 */
class VisualHighlightSetting extends ComponentBase {
    onConnect() {
        const layout = this.getAttribute('layout') || 'detailed';

        if (layout === 'compact') {
            this.classList.add('compact-setting-row');
            this.replaceChildren(compactTemplate.content.cloneNode(true));

            const labelText = browser.i18n.getMessage('devmodeSetDebugVisualsLabel') || 'Visual Highlight';
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

        // The state lives in a local key of its own, with the config only as a fallback,
        // so it takes both a config subscription and a listener for that key.
        this.addTeardown(onConfigValue(
            (config) => config.debugVisualsEnabled,
            () => this.sync(toggleBtn)
        ));

        const onStorageChanged = (changes, areaName) => {
            if (areaName !== 'local' || !('visualHighlightEnabled' in changes)) return;
            this.sync(toggleBtn);
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        this.addTeardown(() => browser.storage.onChanged.removeListener(onStorageChanged));
    }

    /**
     * Fetch and apply latest values.
     */
    async sync(toggleBtn) {
        const isEnabled = await model.read.getVisualHighlightEnabled();
        if (!this.isConnected) return;

        toggleBtn.checked = isEnabled;
    }

    /**
     * Perform initial state loading and event registration.
     */
    async loadState(toggleBtn, layout) {
        await this.sync(toggleBtn);

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
                await controller.setVisualHighlightEnabled(checked);
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: {
                            key: 'visualHighlightEnabled',
                            value: checked,
                            success: true,
                            message: browser.i18n.getMessage('settingSavedSuccess') || 'Setting saved!'
                        }
                    }));
                }
            } catch (err) {
                console.error('Failed to save debug visuals setting:', err);
                toggleBtn.checked = !checked;
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: {
                            key: 'visualHighlightEnabled',
                            value: !checked,
                            success: false,
                            message: browser.i18n.getMessage('settingSavedError') || 'Error saving setting'
                        }
                    }));
                }
            }
        }, { signal: this.signal });
    }
}

defineComponent('visual-highlight-setting', VisualHighlightSetting);
