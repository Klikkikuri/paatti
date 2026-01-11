import { browser, getLogger } from '../utils.js';
import { getConfig } from '../config.js';

const log = getLogger('options/utils');

const isSiteEnabled = async (domain) => {
    const config = await getConfig();
    const siteConfig = config.siteConfigs ? config.siteConfigs[domain] || {} : {};

    if (!siteConfig) {
        log(`No site config for ${domain}, returning false`);
        return false;
    }

    let enabled = siteConfig.enabled !== undefined ? siteConfig.enabled : false;

    const current = await browser().permissions.getAll();
    const hasPermission = current.origins.some(origin => siteConfig.origins.includes(origin));

    return enabled && hasPermission;
};

export { isSiteEnabled };