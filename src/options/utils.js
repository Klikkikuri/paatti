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

    const enabled = siteConfig.enabled !== undefined ? siteConfig.enabled : false;
    const origins = siteConfig.origins || [];
    const hasPermission = origins.length > 0 ? await browser().permissions.contains({ origins }) : false;

    return enabled && hasPermission;
};

// Display product name and version in the options page header and footer
const displayProductInfo = () => {
    try {
        const manifest = browser().runtime.getManifest();

        const productNameEl = document.getElementById("product-name");
        const productVersionEl = document.getElementById("product-version");
        if (productNameEl) {
            productNameEl.textContent = manifest.name;
        }
        if (productVersionEl) {
            productVersionEl.textContent = `v${manifest.version}`;
        }
    } catch (e) {
        log("Failed to load product name and version from manifest:", e);
    }
};
/**
 * Gets localized title and description for a clickbait level (0-4).
 * @param {number} level - Clickbait level index (0-4)
 * @returns {{title: string, description: string}} Title and description
 */
const getClickbaitLevelInfo = (level) => {
    const title = browser().i18n.getMessage(`clickbaitLevel${level}Title`);
    const description = browser().i18n.getMessage(`clickbaitLevel${level}Desc`);
    return { title, description };
};

export { isSiteEnabled, displayProductInfo, getClickbaitLevelInfo };