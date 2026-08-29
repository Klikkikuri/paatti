import browser from '../browser-api.js';
import { getLogger } from '../utils.js';
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
    const hasPermission = origins.length > 0 ? await browser.permissions.contains({ origins }) : false;

    return enabled && hasPermission;
};

// Display product name and version in the options page header and footer
const displayProductInfo = () => {
    try {
        const manifest = browser.runtime.getManifest();

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
    const title = browser.i18n.getMessage(`clickbaitLevel${level}Title`);
    const description = browser.i18n.getMessage(`clickbaitLevel${level}Desc`);
    return { title, description };
};

/**
 * The message key naming a clickbaitiness level, from the level itself.
 * @param {string} level - A Clickbaitiness.LEVELS entry
 * @returns {string}
 */
const levelToI18nKey = (level) => `clickbaitinessLabel_${level.replaceAll(" ", "_")}`;

/**
 * Gets a human-readable browser name + version using native structured APIs.
 * Avoids User-Agent string parsing entirely.
 * @returns {Promise<string>}
 */
const getBrowserInfo = async () => {
    // Firefox native API
    if (browser.runtime.getBrowserInfo) {
        const info = await browser.runtime.getBrowserInfo();
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

/**
 * Localizes DOM elements under a given root element using browser.i18n.getMessage.
 * Supports:
 * - data-i18n: sets textContent
 * - data-i18n-placeholder: sets placeholder attribute
 * - data-i18n-title: sets title attribute
 * - data-i18n-aria-label: sets aria-label attribute
 * - data-i18n-alt: sets alt attribute
 *
 * Also updates <html lang="..."> if the root is document or documentElement.
 *
 * @param {Document|HTMLElement|DocumentFragment} root - Root DOM element or document to localize.
 */
const localizeDocument = (root = document) => {
    try {
        const i18n = browser?.i18n;
        if (!i18n || !i18n.getMessage) return;

        // Set document language if processing top-level document
        if (typeof document !== 'undefined' && (root === document || root === document.documentElement)) {
            const uiLocale = i18n.getUILanguage?.() || i18n.getMessage('@@ui_locale') || 'en';
            if (document.documentElement) {
                document.documentElement.lang = uiLocale;
            }
        }

        // Check root element attributes if applicable
        if (root.hasAttribute) {
            if (root.hasAttribute('data-i18n')) {
                const msg = i18n.getMessage(root.getAttribute('data-i18n'));
                if (msg) root.textContent = msg;
            }
            if (root.hasAttribute('data-i18n-placeholder')) {
                const msg = i18n.getMessage(root.getAttribute('data-i18n-placeholder'));
                if (msg) root.setAttribute('placeholder', msg);
            }
            if (root.hasAttribute('data-i18n-title')) {
                const msg = i18n.getMessage(root.getAttribute('data-i18n-title'));
                if (msg) root.setAttribute('title', msg);
            }
            if (root.hasAttribute('data-i18n-aria-label')) {
                const msg = i18n.getMessage(root.getAttribute('data-i18n-aria-label'));
                if (msg) root.setAttribute('aria-label', msg);
            }
            if (root.hasAttribute('data-i18n-alt')) {
                const msg = i18n.getMessage(root.getAttribute('data-i18n-alt'));
                if (msg) root.setAttribute('alt', msg);
            }
        }

        // Translate textContent for child elements
        const textElements = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
        for (const el of textElements) {
            const key = el.getAttribute('data-i18n');
            const message = i18n.getMessage(key);
            if (message) {
                el.textContent = message;
            }
        }

        // Translate placeholders
        const placeholderElements = root.querySelectorAll ? root.querySelectorAll('[data-i18n-placeholder]') : [];
        for (const el of placeholderElements) {
            const key = el.getAttribute('data-i18n-placeholder');
            const message = i18n.getMessage(key);
            if (message) {
                el.setAttribute('placeholder', message);
            }
        }

        // Translate title attributes
        const titleElements = root.querySelectorAll ? root.querySelectorAll('[data-i18n-title]') : [];
        for (const el of titleElements) {
            const key = el.getAttribute('data-i18n-title');
            const message = i18n.getMessage(key);
            if (message) {
                el.setAttribute('title', message);
            }
        }

        // Translate aria-label attributes
        const ariaLabelElements = root.querySelectorAll ? root.querySelectorAll('[data-i18n-aria-label]') : [];
        for (const el of ariaLabelElements) {
            const key = el.getAttribute('data-i18n-aria-label');
            const message = i18n.getMessage(key);
            if (message) {
                el.setAttribute('aria-label', message);
            }
        }

        // Translate alt attributes
        const altElements = root.querySelectorAll ? root.querySelectorAll('[data-i18n-alt]') : [];
        for (const el of altElements) {
            const key = el.getAttribute('data-i18n-alt');
            const message = i18n.getMessage(key);
            if (message) {
                el.setAttribute('alt', message);
            }
        }
    } catch (err) {
        log('Error localizing document:', err);
    }
};

export {
    isSiteEnabled,
    displayProductInfo,
    getClickbaitLevelInfo,
    levelToI18nKey,
    getBrowserInfo,
    formatIsoWithTimezone,
    localizeDocument
};