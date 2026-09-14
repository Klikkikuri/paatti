import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { defineComponent } from './component-utils.js';
import { createToggleSetting } from './toggle-setting.js';

/** Whether a provider may claim a site key the bundled set or an earlier provider already claims. */
const ProviderShadowingSetting = createToggleSetting({
    settingKey: () => 'providerShadowingEnabled',

    ids: () => ({ compact: 'settingsview-provider-shadowing-enabled', detailed: 'providerShadowingEnabled' }),

    labels: () => ({
        compact: browser.i18n.getMessage('providerShadowingLabel') || 'Allow providers to override sites',
        title: browser.i18n.getMessage('providerShadowingTitle') || 'Allow providers to override sites',
        description: browser.i18n.getMessage('providerShadowingDesc')
            || 'Lets an added provider take over a site the bundled set or an earlier provider already claims',
    }),

    read: (el, apply) => onConfigValue((config) => config.providerShadowingEnabled, apply),

    write: (el, checked) => controller.setProviderShadowingEnabled(checked),

    messages: {
        savedKey: 'providerShadowingSaved',
        savedFallback: 'Provider shadowing setting saved!',
        errorKey: 'providerShadowingSaveError',
        errorFallback: 'Error saving provider shadowing setting',
    },
});

defineComponent('provider-shadowing-setting', ProviderShadowingSetting);
