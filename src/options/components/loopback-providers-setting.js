import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { defineComponent } from './component-utils.js';
import { createToggleSetting } from './toggle-setting.js';

/** Whether a provider may be reached at a loopback address -- the user's own machine. */
const LoopbackProvidersSetting = createToggleSetting({
    settingKey: () => 'loopbackProvidersEnabled',

    ids: () => ({ compact: 'settingsview-loopback-providers-enabled', detailed: 'loopbackProvidersEnabled' }),

    labels: () => ({
        compact: browser.i18n.getMessage('loopbackProvidersLabel') || 'Allow providers on this machine',
        title: browser.i18n.getMessage('loopbackProvidersTitle') || 'Allow providers on this machine',
        description: browser.i18n.getMessage('loopbackProvidersDesc')
            || 'Lets a provider manifest be fetched from localhost, for running one during development',
    }),

    read: (el, apply) => onConfigValue((config) => config.loopbackProvidersEnabled, apply),

    write: (el, checked) => controller.setLoopbackProvidersEnabled(checked),

    messages: {
        savedKey: 'loopbackProvidersSaved',
        savedFallback: 'Loopback provider setting saved!',
        errorKey: 'loopbackProvidersSaveError',
        errorFallback: 'Error saving loopback provider setting',
    },
});

defineComponent('loopback-providers-setting', LoopbackProvidersSetting);
