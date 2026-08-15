"use strict";

import { browser, getLogger } from "./utils.js";
import { getConfig } from "./config.js";
import { fetchRahtiData, fetchRahtiDataWithRetry } from "./rahti.js";
import { controller } from "./controller.js";
import { getFaviconKey, makeFaviconEntry, isFaviconExpired } from "./faviconCache.js";
import "./../build/wasm_exec.js";

const log = getLogger("background");

/** Tracks domains whose favicon fetch is currently in-flight within this SW lifecycle. */
const pendingFaviconDomains = new Set();

const DEFAULT_ENVIRONMENT = "free";
const PULL_ALARM_NAME = "periodic-data-pull";


/**
 * Re-registers the dynamic content script based on current configuration.
 *
 * Collects enabled site origins from config, unregisters any previously
 * registered script, and registers it again only when there are enabled
 * origins.
 */
async function updateDynamicContentScripts() {
    try {
        const config = await getConfig();
        const enabledOrigins = [];

        if (config.enabled) {
            for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                if (siteConfig.enabled && siteConfig.origins) {
                    enabledOrigins.push(...siteConfig.origins);
                }
            }
        }

        try {
            await browser().scripting.unregisterContentScripts({ ids: ["paatti-content-script"] });
        } catch (e) {
            // Ignore if not registered yet
        }

        if (enabledOrigins.length > 0) {
            log("Registering content scripts for origins:", enabledOrigins);
            // For rewiews grep: chrome.scripting.registerContentScripts()
            // For rewiews grep: browser.scripting.registerContentScripts()

            await browser().scripting.registerContentScripts([{
                id: "paatti-content-script",
                js: [
                    "src/contentScript.js"
                ],
                css: [
                    "src/contentStyle.css"
                ],
                matches: enabledOrigins,
                runAt: "document_idle"
            }]);
        } else {
            log("No origins enabled, no content scripts registered.");
        }
    } catch (err) {
        log("Error updating dynamic content scripts:", err);
    }
}


async function scheduleAlarm(minutes) {
    await browser().alarms.clear(PULL_ALARM_NAME);
    browser().alarms.create(PULL_ALARM_NAME, {
        periodInMinutes: minutes
    });
    log(`Alarm rescheduled for every ${minutes} minutes.`);
}

/**
 * Handle alarm settings changes.
 */
browser().storage.onChanged.addListener(async (changes, area) => {
    const isPreferencesChanged = area === 'local' && changes.userPreferences;
    const isOverridesChanged = area === 'sync' && changes.userSiteOverrides;
    const isModifiersChanged = area === 'sync' && changes.modifiers;

    if (isPreferencesChanged || isOverridesChanged) {
        log("Config changed, updating dynamic content scripts...");
        await updateDynamicContentScripts();
    }

    if (isPreferencesChanged) {
        const oldVal = changes.userPreferences.oldValue || {};
        const newVal = changes.userPreferences.newValue || {};
        if (newVal.refreshIntervalMinutes !== oldVal.refreshIntervalMinutes || newVal.environment !== oldVal.environment) {
            const config = await getConfig();
            const intervalMinutes = config.refreshIntervalMinutes || 20;
            log(`Effective refresh interval is now ${intervalMinutes} minutes.`);
            await scheduleAlarm(intervalMinutes);
        }
        if (newVal.environment !== oldVal.environment) {
            log("Environment changed, triggering fresh database fetch...");
            fetchRahtiDataWithRetry({ force: true }).catch((err) => {
                log("Failed to fetch Rahti data on environment change:", err);
            });
        }
        if (newVal.clickbaitLevel !== oldVal.clickbaitLevel || newVal.enabled !== oldVal.enabled) {
            log("Clickbait level or extension status changed, notifying active tab");
            try {
                const tabs = await browser().tabs.query({ active: true, currentWindow: true });
                if (tabs[0] && tabs[0].id) {
                    await browser().tabs.sendMessage(tabs[0].id, { command: "convertClickbaits" });
                }
            } catch (err) {
                // ignore error if tab doesn't have listener
                log("Tab message send failed (likely no listener):", err);
            }
        }
    }

    if (isModifiersChanged) {
        log("Modifiers changed, notifying active tab");
        try {
            const tabs = await browser().tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].id) {
                await browser().tabs.sendMessage(tabs[0].id, { command: "convertClickbaits" });
            }
        } catch (err) {
            log("Tab message send failed (likely no listener):", err);
        }
    }
});

browser().runtime.onInstalled.addListener(async () => {

    // Detect environment
    const environment = await new Promise((resolve) => {
        browser().management.getSelf((info) => {
            if (info.installType === 'development') {
                resolve("development");
            } else {
                resolve(DEFAULT_ENVIRONMENT);
            }
        });
    });

    try {
        // Set default environment on install
        await browser().storage.local.set({ userPreferences: { environment: environment } });
        log(`Set default environment to '${environment}' on install.`);
    } catch (error) {
        log("Error setting default environment on install:", error);
    }
    // Run an initial Rahti data fetch on install so the extension has data immediately.
    // Initial fetch of Rahti data
    try {
        await fetchRahtiDataWithRetry();
    } catch (err) {
        log("Failed to perform initial fetch of Rahti data on install:", err);
    }

    // Set up periodic fetching of Rahti data
    const config = await getConfig();
    const intervalMinutes = config.refreshIntervalMinutes || 30;

    await scheduleAlarm(intervalMinutes);
    await updateDynamicContentScripts();
});

// Handle periodic alarm to fetch Rahti data
browser().alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PULL_ALARM_NAME) {
        log("Alarm triggered: fetching Rahti data.");
        fetchRahtiDataWithRetry().catch((err) => {
            log("Failed to fetch Rahti data on alarm:", err);
        });
    }
});

// Handle manual database update and URL signature requests
let suolaPromise = null;

async function initSuola() {
    if (suolaPromise) return suolaPromise;
    suolaPromise = (async () => {
        try {
            const go = new Go();
            const wasmUrl = browser().runtime.getURL("build/js.wasm");
            const response = await fetch(wasmUrl);
            const result = await WebAssembly.instantiateStreaming(response, go.importObject);
            go.run(result.instance);
            log("Suola WebAssembly initialized in background.");
        } catch (err) {
            log("Failed to initialize Suola WebAssembly in background:", err);
            suolaPromise = null;
            throw err;
        }
    })();
    return suolaPromise;
}

browser().runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateDatabase") {
        log("Manual database update requested.");
        // Manual updates invoke fetchRahtiData directly without retry logic
        fetchRahtiData({ force: true })
            .then((success) => {
                if (success) {
                    browser().storage.local.get("lastDatabaseUpdate").then((result) => {
                        sendResponse({ success: true, lastDatabaseUpdate: result.lastDatabaseUpdate });
                    });
                } else {
                    sendResponse({ success: false, error: "Tietokannan haku epäonnistui kaikista osoitteista." });
                }
            })
            .catch((error) => {
                log("Manual database update failed:", error);
                sendResponse({ success: false, error: error.message || String(error) });
            });
        return true; // Keep message channel open for async response
    }

    if (message.action === "hashUrls") {
        initSuola().then(() => {
            if (typeof globalThis.hashUrl === "function") {
                const results = {};
                for (const url of message.urls) {
                    try {
                        results[url] = globalThis.hashUrl(url);
                    } catch (e) {
                        log(`Error hashing URL '${url}':`, e);
                        results[url] = null;
                    }
                }
                sendResponse({ success: true, hashes: results });
            } else {
                sendResponse({ success: false, error: "hashUrl function not found after initialization" });
            }
        }).catch((err) => {
            sendResponse({ success: false, error: err.message || String(err) });
        });
        return true; // Keep message channel open for async response
    }

    if (message.action === "storeFavicon") {
        const { domain, url } = message;
        if (!domain || !url) return;

        // In-flight guard: skip if a fetch for this domain is already running
        if (pendingFaviconDomains.has(domain)) return;

        const key = getFaviconKey(domain);
        (async () => {
            // In-flight guard inside async flow to avoid race before the first await
            if (pendingFaviconDomains.has(domain)) return;
            pendingFaviconDomains.add(domain);
            try {
                // Persistent cache check: skip if valid and not expired
                const stored = await browser().storage.local.get(key);
                const existing = stored[key];
                if (!isFaviconExpired(existing)) return;

                const response = await fetch(url);
                const altDomain = domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`;
                if (!response.ok) {
                    // Negatively cache: prevents retry on every page load
                    const negEntry = makeFaviconEntry(null);
                    await browser().storage.local.set({
                        [key]: negEntry,
                        [getFaviconKey(altDomain)]: negEntry
                    });
                    log(`Favicon fetch failed for ${domain} (HTTP ${response.status}), negatively cached.`);
                    return;
                }

                const buffer = await response.arrayBuffer();
                const contentType = response.headers.get("content-type") || "image/x-icon";

                // Manual Base64 conversion — FileReader is unavailable in Service Workers
                const bytes = new Uint8Array(buffer);
                let binary = "";
                const chunk = 8192;
                for (let i = 0; i < bytes.byteLength; i += chunk) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }
                const dataUri = `data:${contentType};base64,${btoa(binary)}`;
                const favEntry = makeFaviconEntry(dataUri);

                await browser().storage.local.set({
                    [key]: favEntry,
                    [getFaviconKey(altDomain)]: favEntry
                });
                log(`Favicon cached for ${domain}.`);
            } catch (err) {
                // Transient network error — do NOT negatively cache; will retry next page load
                log(`Favicon fetch error for ${domain}:`, err);
            } finally {
                pendingFaviconDomains.delete(domain);
            }
        })();
        // No return true — sendResponse is never called for this action
        return;
    }
});

// Perform initial update of dynamic content scripts on startup
updateDynamicContentScripts().catch((err) => {
    log("Failed to run initial script update:", err);
});

/**
 * Checks whether the stored database timestamp is missing or older than the refresh interval.
 *
 * @returns {Promise<boolean>} True if database is missing or stale.
 */
async function isDatabaseStale() {
    try {
        const config = await getConfig();
        const intervalMinutes = config.refreshIntervalMinutes || 30;
        const result = await browser().storage.local.get("lastDatabaseUpdate");
        if (!result.lastDatabaseUpdate) {
            return true;
        }
        const ageMs = Date.now() - result.lastDatabaseUpdate;
        return ageMs >= intervalMinutes * 60 * 1000;
    } catch (err) {
        log("Failed checking database staleness:", err);
        return false;
    }
}

// Handle browser startup event to ensure database freshness
if (browser().runtime && browser().runtime.onStartup) {
    browser().runtime.onStartup.addListener(async () => {
        log("Browser startup detected.");
        try {
            const config = await getConfig();
            const intervalMinutes = config.refreshIntervalMinutes || 30;
            await scheduleAlarm(intervalMinutes);
            if (await isDatabaseStale()) {
                log("Database is stale on browser startup, triggering background fetch with retry...");
                fetchRahtiDataWithRetry().catch((err) => {
                    log("Failed to fetch Rahti data on browser startup:", err);
                });
            }
        } catch (err) {
            log("Startup check failed:", err);
        }
    });
}

// Ensure periodic alarm is scheduled and database is checked on background script load
(async () => {
    try {
        const alarm = await browser().alarms.get(PULL_ALARM_NAME);
        const config = await getConfig();
        const intervalMinutes = config.refreshIntervalMinutes || 30;
        if (!alarm) {
            await scheduleAlarm(intervalMinutes);
        }
        if (await isDatabaseStale()) {
            log("Database is stale on script evaluation, triggering background fetch with retry...");
            fetchRahtiDataWithRetry().catch((err) => {
                log("Failed to fetch Rahti data on background script evaluation:", err);
            });
        }
    } catch (err) {
        log("Failed checking alarm and database status on script evaluation:", err);
    }
})();


// Listen to browser permission additions to synchronize model state
browser().permissions.onAdded.addListener(async (permissions) => {
    log("Permissions added:", permissions);
    if (permissions.origins) {
        const config = await getConfig();
        for (const origin of permissions.origins) {
            for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                if (siteConfig.origins && siteConfig.origins.includes(origin)) {
                    log(`Enabling site in storage for matched origin: ${domain}`);
                    await controller.setSiteEnabled(true, domain);
                }
            }
        }
    }
});

// Listen to browser permission removals to synchronize model state
browser().permissions.onRemoved.addListener(async (permissions) => {
    log("Permissions removed:", permissions);
    if (permissions.origins) {
        const config = await getConfig();
        for (const origin of permissions.origins) {
            for (const [domain, siteConfig] of Object.entries(config.siteConfigs)) {
                if (siteConfig.origins && siteConfig.origins.includes(origin)) {
                    log(`Disabling site in storage for revoked origin: ${domain}`);
                    await controller.setSiteEnabled(false, domain);
                }
            }
        }
    }
});
