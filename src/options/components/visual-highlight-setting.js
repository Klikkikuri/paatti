import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { model } from '../../model.js';
import { defineComponent } from './component-utils.js';
import { createToggleSetting } from './toggle-setting.js';

/**
 * The Visual Highlight / Debug Visuals setting.
 *
 * Its state lives in a local key of its own with the config only as a fallback, so it
 * takes both a config subscription and a listener for that key.
 */
const VisualHighlightSetting = createToggleSetting({
    settingKey: () => 'visualHighlightEnabled',

    ids: () => ({ compact: 'devmode-setDebugVisuals', detailed: 'debugVisuals' }),

    labels: () => ({
        compact: browser.i18n.getMessage('devmodeSetDebugVisualsLabel') || 'Visual Highlight',
        title: browser.i18n.getMessage('devmodeVisualHighlightTitle') || 'Visual Highlight',
        description: browser.i18n.getMessage('devmodeVisualHighlightDesc')
            || 'Show visual debug indicators on processed elements',
    }),

    read: (el, apply) => {
        const sync = async () => {
            const enabled = await model.read.getVisualHighlightEnabled();
            // The read resolves a turn later, by which time the element may be gone.
            if (!el.isConnected) return;

            apply(enabled);
        };

        // Fires at once, which is what paints the initial state.
        el.addTeardown(onConfigValue((config) => config.debugVisualsEnabled, sync));

        const onStorageChanged = (changes, areaName) => {
            if (areaName !== 'local' || !('visualHighlightEnabled' in changes)) return;
            sync();
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        el.addTeardown(() => browser.storage.onChanged.removeListener(onStorageChanged));
    },

    write: (el, checked) => controller.setVisualHighlightEnabled(checked),
});

defineComponent('visual-highlight-setting', VisualHighlightSetting);
