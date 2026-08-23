import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import './toggle-button.js';
import '../../components/klikkikuri-ai-badge.js';
import '../../components/klikkikuri-video-badge.js';
import { ComponentBase, defineComponent } from './component-utils.js';

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
 * Per-modifier metadata used to populate labels, descriptions, and badge previews.
 * When registering a new modifier, add an entry here and ensure the corresponding badge Web Component is imported/registered (so `badgeTag` is defined).
 *
 * @type {Record<string, {labelKey: string, labelFallback: string, titleKey: string, titleFallback: string, descKey: string, descFallback: string, badgeTag: string}>}
 */
const MODIFIER_META = {
    aiSlop: {
        labelKey:      'modifierAiSlopLabel',
        labelFallback: 'Mark AI generated content',
        titleKey:      'modifierAiSlopTitle',
        titleFallback: 'AI Content Marker',
        descKey:       'modifierAiSlopDesc',
        descFallback:  'Adds AI indicator to headlines when the content is primarily created or translated using AI.',
        badgeTag:      'klikkikuri-ai-badge',
    },
    video: {
        labelKey:      'modifierVideoLabel',
        labelFallback: 'Mark video content',
        titleKey:      'modifierVideoTitle',
        titleFallback: 'Video Content Marker',
        descKey:       'modifierVideoDesc',
        descFallback:  'Shows a video icon next to headlines when the link is mostly video rather than a written article.',
        badgeTag:      'klikkikuri-video-badge',
    },
};

/**
 * Custom element managing title modifier options (e.g. Tekoälymerkintä / AI Slop, Videomerkintä / Video).
 * Supports layout="compact" (popup setting) and layout="detailed" (options page).
 */
class TitleModifierSetting extends ComponentBase {
    onConnect() {
        const modifier = this.getAttribute('modifier') || 'aiSlop';
        const layout = this.getAttribute('layout') || 'detailed';
        const meta = MODIFIER_META[modifier];

        if (layout === 'compact') {
            this.classList.add('compact-setting-row');
            this.replaceChildren(compactTemplate.content.cloneNode(true));

            const labelText = meta
                ? (browser.i18n.getMessage(meta.labelKey) || meta.labelFallback)
                : modifier;

            const labelEl = this.querySelector('.label-text');
            if (labelEl) labelEl.textContent = labelText;
        } else {
            this.replaceChildren(detailedTemplate.content.cloneNode(true));

            const title = meta
                ? (browser.i18n.getMessage(meta.titleKey) || meta.titleFallback)
                : modifier;
            const description = meta
                ? (browser.i18n.getMessage(meta.descKey) || meta.descFallback)
                : '';

            const titleEl = this.querySelector('.title-text');
            const descEl = this.querySelector('.description-text');
            if (titleEl) {
                titleEl.textContent = title + ' ';
                if (meta?.badgeTag) {
                    const badgeElem = document.createElement(meta.badgeTag);
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

        // Selects this modifier alone, so the other one's writes do not wake it.
        this.addTeardown(onConfigValue(
            (config) => Boolean(config.modifiers?.[modifier]),
            (enabled) => { toggleBtn.checked = enabled; }
        ));
    }

    /**
     * Wire up the control. The checked state itself arrives from onConfigValue.
     */
    loadState(toggleBtn, modifier, layout) {
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
                await controller.setModifierEnabled(modifier, checked);
                if (layout !== 'compact') {
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: {
                            key: `modifier-${modifier}`,
                            value: checked,
                            success: true,
                            message: browser.i18n.getMessage('settingSavedSuccess') || 'Setting saved!'
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
                            message: browser.i18n.getMessage('settingSavedError') || 'Error saving setting'
                        }
                    }));
                }
            }
        }, { signal: this.signal });
    }
}

defineComponent('title-modifier-setting', TitleModifierSetting);
