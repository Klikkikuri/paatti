import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import '../../components/klikkikuri-ai-badge.js';
import '../../components/klikkikuri-video-badge.js';
import { defineComponent } from './component-utils.js';
import { createToggleSetting } from './toggle-setting.js';

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

/** Which modifier an instance is for; the attribute is the only per-instance state. */
const modifierOf = (el) => el.getAttribute('modifier') || 'aiSlop';

/** Resolve one of the meta strings, falling back to the modifier name when it is unknown. */
const text = (meta, key, fallback, whenUnknown) =>
    (meta ? (browser.i18n.getMessage(meta[key]) || meta[fallback]) : whenUnknown);

/** Title modifier options (Tekoälymerkintä / AI Slop, Videomerkintä / Video). */
const TitleModifierSetting = createToggleSetting({
    settingKey: (el) => `modifier-${modifierOf(el)}`,

    ids: (el) => {
        const id = `modifier-${modifierOf(el)}`;
        return { compact: id, detailed: id };
    },

    labels: (el) => {
        const modifier = modifierOf(el);
        const meta = MODIFIER_META[modifier];
        return {
            compact: text(meta, 'labelKey', 'labelFallback', modifier),
            title: text(meta, 'titleKey', 'titleFallback', modifier),
            description: text(meta, 'descKey', 'descFallback', ''),
        };
    },

    // The badge is a preview of what the modifier puts on a headline.
    decorate: (el, titleEl) => {
        const badgeTag = MODIFIER_META[modifierOf(el)]?.badgeTag;
        if (!badgeTag) return;

        const badge = document.createElement(badgeTag);
        badge.style.marginLeft = '0.25em';
        titleEl.append(' ', badge);
    },

    // Selects this modifier alone, so the other one's writes do not wake it.
    read: (el, apply) => onConfigValue(
        (config) => Boolean(config.modifiers?.[modifierOf(el)]),
        apply
    ),

    write: (el, checked) => controller.setModifierEnabled(modifierOf(el), checked),
});

defineComponent('title-modifier-setting', TitleModifierSetting);
