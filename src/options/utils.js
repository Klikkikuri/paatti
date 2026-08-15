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

/**
 * Gets a human-readable browser name + version using native structured APIs.
 * Avoids User-Agent string parsing entirely.
 * @returns {Promise<string>}
 */
const getBrowserInfo = async () => {
    // Firefox native API
    if (browser().runtime.getBrowserInfo) {
        const info = await browser().runtime.getBrowserInfo();
        return `${info.name} ${info.version}`;
    }

    // Chromium native API
    const brands = navigator.userAgentData?.brands;
    if (brands?.length) {
        const brand = brands.find((b) => b.brand && !/^not/i.test(b.brand)) ?? brands.at(-1);
        return brand ? `${brand.brand} ${brand.version}` : 'Unknown';
    }

    return 'Unknown';
};

/**
 * Formats a timestamp or Date into an ISO 8601 string with local timezone offset.
 * Example: "2026-08-15T12:36:28+03:00"
 * @param {number|string|Date|null} dateInput
 * @returns {string}
 */
const formatIsoWithTimezone = (dateInput) => {
    if (!dateInput) return '—';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '—';

    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absOffset / 60));
    const offsetMins = pad(absOffset % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMins}`;
};

export { isSiteEnabled, displayProductInfo, getClickbaitLevelInfo, getBrowserInfo, formatIsoWithTimezone };