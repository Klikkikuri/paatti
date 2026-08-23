import browser from '../../browser-api.js';
import { controller } from '../../controller.js';
import { onConfigValue } from '../../config.js';
import { defineComponent } from './component-utils.js';
import { createToggleSetting } from './toggle-setting.js';

/** The global extension on/off state ("Aktivoi Paatti"). */
const MasterSwitchSetting = createToggleSetting({
    settingKey: () => 'extensionEnabled',

    ids: () => ({ compact: 'settingsview-extension-enabled', detailed: 'extensionEnabled' }),

    labels: () => ({
        compact: browser.i18n.getMessage('settingsviewMasterSwitchLabel') || 'Activate Paatti',
        title: browser.i18n.getMessage('masterSwitchTitle') || 'Activate Paatti',
        description: browser.i18n.getMessage('masterSwitchDesc')
            || 'When enabled, the extension processes clickbait headlines on configured sites',
    }),

    read: (el, apply) => onConfigValue((config) => config.enabled, apply),

    write: (el, checked) => controller.setEnabled(checked),

    messages: {
        savedKey: 'masterSwitchSaved',
        savedFallback: 'Extension status saved!',
        errorKey: 'masterSwitchSaveError',
        errorFallback: 'Error saving extension status',
    },
});

defineComponent('master-switch-setting', MasterSwitchSetting);
