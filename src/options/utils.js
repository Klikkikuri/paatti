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

export { isSiteEnabled, displayProductInfo };