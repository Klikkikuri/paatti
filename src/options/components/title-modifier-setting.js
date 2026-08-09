import { browser } from '../../utils.js';
import { controller } from '../../controller.js';
import { getConfig } from '../../config.js';
import './toggle-button.js';
import '../../components/klikkikuri-ai-badge.js';

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
            this.classList.add('compact-setting-row');
            this.replaceChildren(compactTemplate.content.cloneNode(true));

            let labelText = 'Mark AI generated content';
            if (modifier === 'aiSlop') {
                labelText = browser().i18n.getMessage('modifierAiSlopLabel') || 'Mark AI generated content';
            }

            const labelEl = this.querySelector('.label-text');
            if (labelEl) labelEl.textContent = labelText;
        } else {
            this.replaceChildren(detailedTemplate.content.cloneNode(true));

            let title = 'AI Content Marker';
            let description = 'Adds AI indicator to headlines when the content is primarily created or translated using AI.';

            if (modifier === 'aiSlop') {
                title = browser().i18n.getMessage('modifierAiSlopTitle') || 'AI Content Marker';
                description = browser().i18n.getMessage('modifierAiSlopDesc') || 'Adds AI indicator to headlines when the content is primarily created or translated using AI.';
            }

            const titleEl = this.querySelector('.title-text');
            const descEl = this.querySelector('.description-text');
            if (titleEl) {
                titleEl.textContent = title + ' ';
                if (modifier === 'aiSlop') {
                    const badgeElem = document.createElement('klikkikuri-ai-badge');
                    badgeElem.style.marginLeft = '0.25em';
                    titleEl.appendChild(badgeElem);
                }
            }
            if (descEl) descEl.textContent = description;
        }

        const toggleBtn = this.querySelector('toggle-button');
        if (toggleBtn) {
            toggleBtn.setAttribute('id', `modifier-${modifier}`);
        }
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
                        detail: {
                            key: `modifier-${modifier}`,
                            value: checked,
                            success: true,
                            message: browser().i18n.getMessage('settingSavedSuccess') || 'Setting saved!'
                        }
                    }));
                }
            } catch (err) {
                console.error(`Failed to save title modifier ${modifier}:`, err);
                toggleBtn.checked = !checked;
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: {
                            key: `modifier-${modifier}`,
                            value: !checked,
                            success: false,
                            message: browser().i18n.getMessage('settingSavedError') || 'Error saving setting'
                        }
                    }));
                }
            }
        });
    }
}

customElements.define('title-modifier-setting', TitleModifierSetting);
