"use strict";

import browser from "./browser-api.js";
import { getLogger, getActiveTab } from "./utils.js";
import { getConfig, PROVIDER_KEY_PREFIX } from "./config.js";
import { refreshProviders, retryDelayMs, reconcileSuolaRules, addProvider } from "./providers.js";
import { model } from "./model.js";
import { controller } from "./controller.js";
import { storeFavicon } from "./favicon-fetch.js";
import { buildFeedbackRequest } from "./feedback.js";
import "./../build/wasm_exec.js";

const log = getLogger("background");

const DEFAULT_ENVIRONMENT = "free";
const PULL_ALARM_NAME = "periodic-data-pull";
/** A retry alarm is named with this prefix and the number of the attempt that it starts. */
const RETRY_ALARM_PREFIX = "default-provider-retry:";


/**
 * Re-registers the dynamic content script based on current configuration.
 *
 * Collects enabled site origins from config, unregisters any previously
 * registered script, and registers it again only when there are enabled
 * origins.
 *
 * Filtered to origins the browser has actually granted before it reaches registerContentScripts():
 * every bundled origin is covered by the static host_permissions and always passes this, but a
 * provider's origin may not be granted yet (or ever), and registerContentScripts() refuses its whole
 * array over one ungranted pattern -- which would otherwise silently stop correction on every bundled
 * site too, not only the provider's.
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

        const grantedOrigins = [];
        for (const origin of enabledOrigins) {
            try {
                if (await browser.permissions.contains({ origins: [origin] })) grantedOrigins.push(origin);
            } catch (e) {
                log(`Permission check failed for ${origin}, treating it as ungranted:`, e);
            }
        }
        if (grantedOrigins.length < enabledOrigins.length) {
            log("Some enabled origins are not yet granted and will not get a content script:",
                enabledOrigins.filter((origin) => !grantedOrigins.includes(origin)));
        }

        try {
            await browser.scripting.unregisterContentScripts({ ids: ["paatti-content-script"] });
        } catch (e) {
            // Ignore if not registered yet
        }

        if (grantedOrigins.length > 0) {
            log("Registering content scripts for origins:", grantedOrigins);
            // For rewiews grep: chrome.scripting.registerContentScripts()
            // For rewiews grep: browser.scripting.registerContentScripts()

            await browser.scripting.registerContentScripts([{
                id: "paatti-content-script",
                js: [
                    "src/contentScript.js"
                ],
                matches: grantedOrigins,
                runAt: "document_idle"
            }]);
        } else {
            log("No granted origins, no content scripts registered.");
        }
    } catch (err) {
        log("Error updating dynamic content scripts:", err);
    }
}


async function scheduleAlarm(minutes) {
    await browser.alarms.clear(PULL_ALARM_NAME);
    browser.alarms.create(PULL_ALARM_NAME, {
        periodInMinutes: minutes
    });
    log(`Alarm rescheduled for every ${minutes} minutes.`);
}

/**
 * Make sure the active environment's default provider(s) are present in the synced `providers` list.
 * Additive only -- never removes anything, so it can never touch a provider the user added themselves,
 * and it never needs to know whether a given URL used to be default in some earlier version. A URL
 * retired from `config.defaultProviders` simply stops being re-added here and (per providers-setting.js)
 * regains its own Remove button on the next render -- no marker or reconciliation state needed.
 *
 * Called from onInstalled (covers a fresh install and every upgrade, since "update"/"browser_update"
 * reach onInstalled too), the environment-change branch, and the periodic alarm -- the last one makes
 * this self-healing against `providers`' own read-modify-write sync races (the same pattern
 * addProvider/removeProvider/setProviderEnabled already use) rather than a one-shot assertion hoping it
 * sticks.
 */
async function seedDefaultProviders() {
    const config = await getConfig();
    for (const url of config.defaultProviders || []) {
        try {
            await addProvider(url); // no-op if already present, per providers.js's own check
        } catch (err) {
            log(`Failed to seed default provider ${url}:`, err);
        }
    }
}

/** The periodic refresh interval in minutes. */
function refreshIntervalMinutes(config) {
    return config.refreshIntervalMinutes || 30;
}

/**
 * One refreshProviders() pass, and a retry alarm when a default provider failed temporarily (see
 * `retryDelayMs()`). An alarm and not a timer, because an idle worker stops after 30 s and a timer does
 * not keep it alive.
 *
 * @param {object} [options] - Passed through to refreshProviders(), e.g. {force: true}.
 * @param {number} [attempt] - The number of this pass, from 1.
 * @returns {Promise<Array<{url: string, scope: Set<string>, error?: string, transient?: boolean,
 *   retryAfterMs?: number}>>}
 */
async function refreshAndScheduleRetry(options = {}, attempt = 1) {
    const results = await refreshProviders(options);

    const config = await getConfig();
    const defaultUrls = new Set((config.defaultProviders || []).filter((u) => config.enabledProviderUrls.includes(u)));
    const delayMs = retryDelayMs(results, defaultUrls, attempt, refreshIntervalMinutes(config) * 60 * 1000);
    if (delayMs !== null) log(`Default provider refresh failed (attempt ${attempt}); retrying in ${delayMs / 1000}s`);
    await replaceRetryAlarm(attempt + 1, delayMs);

    return results;
}

let retryAlarmUpdate = Promise.resolve();

/**
 * Clear every pending retry alarm, then create one for `attempt` after `delayMs` unless it is null.
 *
 * The calls run one after another, so two passes that end together cannot each leave an alarm. A pass
 * with no retry to make cancels the pending one.
 */
function replaceRetryAlarm(attempt, delayMs) {
    retryAlarmUpdate = retryAlarmUpdate.catch(() => {}).then(async () => {
        const pending = (await browser.alarms.getAll()).filter((alarm) => alarm.name.startsWith(RETRY_ALARM_PREFIX));
        await Promise.all(pending.map((alarm) => browser.alarms.clear(alarm.name)));
        if (delayMs !== null) await browser.alarms.create(`${RETRY_ALARM_PREFIX}${attempt}`, { when: Date.now() + delayMs });
    });
    return retryAlarmUpdate;
}

/**
 * Ask the active tab to re-convert. The worker owns this: it is the one context that
 * always sees the write, whichever surface made it.
 */
async function notifyActiveTab() {
    try {
        const tab = await getActiveTab();
        if (tab && tab.id) {
            await browser.tabs.sendMessage(tab.id, { command: "convertClickbaits" });
        }
    } catch (err) {
        // Expected whenever the active tab runs no content script.
        log("Tab message send failed (likely no listener):", err);
    }
}

/**
 * Handle alarm settings changes.
 */
browser.storage.onChanged.addListener(async (changes, area) => {
    const isPreferencesChanged = area === 'local' && changes.userPreferences;
    const isOverridesChanged = area === 'sync' && changes.userSiteOverrides;
    const isModifiersChanged = area === 'sync' && changes.modifiers;
    // A provider's origins can change with every refresh, not just when it is added or removed --
    // without this, a registered content script keeps a stale matches array until some unrelated
    // change happens to touch userPreferences/userSiteOverrides too.
    const isProvidersChanged = area === 'sync' && Boolean(changes.providers);
    const isProviderDataChanged = area === 'local' && Object.keys(changes).some((key) => key.startsWith(PROVIDER_KEY_PREFIX));

    if (isPreferencesChanged || isOverridesChanged || isProvidersChanged || isProviderDataChanged) {
        log("Config changed, updating dynamic content scripts...");
        await updateDynamicContentScripts();
    }

    if (isPreferencesChanged) {
        const oldVal = changes.userPreferences.oldValue || {};
        const newVal = changes.userPreferences.newValue || {};
        if (newVal.refreshIntervalMinutes !== oldVal.refreshIntervalMinutes || newVal.environment !== oldVal.environment) {
            const config = await getConfig();
            const intervalMinutes = refreshIntervalMinutes(config);
            log(`Effective refresh interval is now ${intervalMinutes} minutes.`);
            await scheduleAlarm(intervalMinutes);
        }
        if (newVal.environment !== oldVal.environment) {
            log("Environment changed, refreshing providers...");
            seedDefaultProviders()
                .then(() => refreshAndScheduleRetry())
                .catch((err) => log("Failed to refresh providers on environment change:", err));
        }
        if (newVal.clickbaitLevel !== oldVal.clickbaitLevel
            || newVal.enabled !== oldVal.enabled
            || newVal.environment !== oldVal.environment) {
            log("Configuration changed, notifying active tab");
            await notifyActiveTab();
        }
    }

    if (isModifiersChanged) {
        log("Modifiers changed, notifying active tab");
        await notifyActiveTab();
    }
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {

    // An extension update and a browser update fire here as well, and by then the stored
    // preferences are the user's own. Only a first install has a default to write.
    if (reason === "install") {
        let environment = DEFAULT_ENVIRONMENT;
        try {
            const self = await browser.management.getSelf();
            if (self.installType === "development") {
                environment = "development";
            }
        } catch (error) {
            log("Error detecting environment on install:", error);
        }

        try {
            // Merged rather than replaced: this handler owns the environment, not the siblings
            // beside it.
            const data = await browser.storage.local.get("userPreferences");
            const userPreferences = { ...data.userPreferences, environment };
            await browser.storage.local.set({ userPreferences });
            log(`Set default environment to '${environment}' on install.`);
        } catch (error) {
            log("Error setting default environment on install:", error);
        }
    }

    // Seed the active environment's default provider(s) -- both the fresh-install case and the
    // upgrade path for an existing install that would otherwise silently lose its corrections dataset
    // -- then refresh every provider, with retry scoped to the default one(s).
    await seedDefaultProviders();
    await refreshAndScheduleRetry().then(() => reconcileSuola()).catch((err) => {
        log("Failed to refresh providers on install:", err);
    });

    // Set up periodic fetching of Rahti data
    const config = await getConfig();
    const intervalMinutes = refreshIntervalMinutes(config);

    await scheduleAlarm(intervalMinutes);
    await updateDynamicContentScripts();
});

// Handle periodic alarm to refresh providers (the default dataset included)
browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PULL_ALARM_NAME) {
        log("Alarm triggered: refreshing providers.");
        // Re-seeding here too (not just on install/environment-change) makes the default provider
        // self-healing against providers' own read-modify-write sync races -- cheap and idempotent,
        // so there is no cost to reasserting it on every tick.
        seedDefaultProviders()
            .then(() => refreshAndScheduleRetry())
            .then(() => reconcileSuola())
            .catch((err) => log("Failed to refresh providers on alarm:", err));
    } else if (alarm.name.startsWith(RETRY_ALARM_PREFIX)) {
        const attempt = Number(alarm.name.slice(RETRY_ALARM_PREFIX.length));
        log(`Retry alarm triggered: refresh attempt ${attempt}.`);
        refreshAndScheduleRetry({}, attempt)
            .then(() => reconcileSuola())
            .catch((err) => log("Failed to retry the provider refresh:", err));
    }
});

// Handle manual database update and URL signature requests
let suolaPromise = null;

async function initSuola() {
    if (suolaPromise) return suolaPromise;
    suolaPromise = (async () => {
        try {
            const go = new Go();
            const wasmUrl = browser.runtime.getURL("build/js.wasm");
            let result;
            try {
                const response = await fetch(wasmUrl);
                if (typeof WebAssembly.instantiateStreaming === "function") {
                    result = await WebAssembly.instantiateStreaming(response, go.importObject);
                } else {
                    const bytes = await response.arrayBuffer();
                    result = await WebAssembly.instantiate(bytes, go.importObject);
                }
            } catch (streamErr) {
                log("Streaming WASM instantiation failed, falling back to arrayBuffer:", streamErr);
                const fallbackResponse = await fetch(wasmUrl);
                const bytes = await fallbackResponse.arrayBuffer();
                result = await WebAssembly.instantiate(bytes, go.importObject);
            }
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

/**
 * Suola ready, with every active provider's rules installed as their own named set.
 *
 * Named sets do not survive a service-worker restart, so this reconciles them fresh on every call
 * rather than once: initSuola() itself is idempotent (a second call joins the same promise), but
 * reconcileSuolaRules() is not a one-time bootstrap step the way loading the module is.
 */
async function reconcileSuola() {
    await initSuola();
    await reconcileSuolaRules();
}

/**
 * Post one feedback payload to the endpoint in configuration.
 *
 * A message decides what is submitted, never where it goes. The endpoint belongs to configuration
 * because this handler is reachable from a content script, and one that fetched a URL and a request
 * init of its caller's choosing would be a request-forgery primitive waiting for something hostile to
 * reach it.
 *
 * Not routed through `safeFetch`: a configured endpoint is legitimately localhost during development,
 * which is the address `safeFetch` exists to refuse.
 *
 * @param {object} payload - From `buildFeedbackPayload`.
 * @returns {Promise<Response>}
 */
async function submitFeedback(payload) {
    if (!payload || typeof payload !== "object") throw new Error("No feedback payload in the message");

    const config = await getConfig();
    const { url, init } = buildFeedbackRequest(config.feedbackServerUrl, payload);
    return fetch(url, init);
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateDatabase") {
        log("Manual database update requested.");
        refreshAndScheduleRetry({ force: true })
            .then(async (results) => {
                const config = await getConfig();
                const defaultUrls = new Set(config.defaultProviders || []);
                const defaultResults = results.filter((r) => defaultUrls.has(r.url));
                const anySucceeded = defaultResults.some((r) => !r.error);

                if (defaultResults.length === 0) {
                    sendResponse({
                        success: false,
                        error: browser.i18n.getMessage("databaseUpdateNoDefaultProvider")
                            || "No default provider is active."
                    });
                    return;
                }
                if (!anySucceeded) {
                    sendResponse({ success: false, error: defaultResults[0].error });
                    return;
                }
                const status = await model.read.getDatabaseStatus();
                sendResponse({ success: true, lastDatabaseUpdate: status.lastDatabaseUpdate });
            })
            .catch((error) => {
                log("Manual database update failed:", error);
                sendResponse({ success: false, error: error.message || String(error) });
            });
        return true; // Keep message channel open for async response
    }

    if (message.action === "hashUrls") {
        reconcileSuola().then(async () => {
            if (typeof globalThis.hashUrl !== "function") {
                sendResponse({ success: false, error: "hashUrl function not found after initialization" });
                return;
            }

            // The name a link signs under is the source that owns its host, not the page's: a
            // provider must not be able to answer for a link to a site it does not run. Resolved
            // per URL, since a page can link to hosts several sources are authoritative for.
            //
            // A source is only passed as a name when it actually has a named set defined: a
            // provider can shadow a domain's site-configs alone, with no suola-rules resource of its
            // own, and hashUrl(url, name) fails closed (null) for a name with nothing behind it --
            // falling back to the bundled/catch-all signature is correct here, not a bug to surface.
            const activeNames = new Set(typeof globalThis.listRules === "function" ? globalThis.listRules() : []);
            const results = {};
            for (const url of message.urls) {
                try {
                    let source = null;
                    try {
                        source = await model.read.getSourceForHost(new URL(url).hostname);
                    } catch {
                        // Not a parseable URL; hashUrl below rejects it on its own terms.
                    }
                    const name = source && activeNames.has(source) ? source : null;
                    results[url] = name ? globalThis.hashUrl(url, name) : globalThis.hashUrl(url);
                } catch (e) {
                    log(`Error hashing URL '${url}':`, e);
                    results[url] = null;
                }
            }
            sendResponse({ success: true, hashes: results });
        }).catch((err) => {
            sendResponse({ success: false, error: err.message || String(err) });
        });
        return true; // Keep message channel open for async response
    }

    if (message.action === "submitFeedback") {
        // One path for the popup and the in-page dialog both, in the one context that does not depend on
        // the visited page. `mode: "no-cors"` makes the response opaque: success means the request left.
        submitFeedback(message.payload)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
                log("Failed to submit feedback:", err);
                sendResponse({ success: false, error: err.message || String(err) });
            });
        return true; // Keep message channel open for async response
    }

    if (message.action === "storeFavicon") {
        // The page chose this URL, so nothing here is taken from the message but the URL itself:
        // favicon-fetch.js writes under the sender's domain and validates the URL against it.
        storeFavicon(sender?.url, message.url);
        // No return true — sendResponse is never called for this action
        return;
    }
});

// Perform initial update of dynamic content scripts on startup
updateDynamicContentScripts().catch((err) => {
    log("Failed to run initial script update:", err);
});

/**
 * Checks whether the last refresh attempt is missing or older than the refresh interval. The attempt and
 * not the last success, so that a failing provider is not fetched again on each worker start.
 *
 * @returns {Promise<boolean>} True if database is missing or stale.
 */
async function isDatabaseStale() {
    try {
        const config = await getConfig();
        const intervalMinutes = refreshIntervalMinutes(config);
        const { lastDatabaseCheck } = await model.read.getDatabaseStatus();
        if (!lastDatabaseCheck) {
            return true;
        }
        const ageMs = Date.now() - lastDatabaseCheck;
        return ageMs >= intervalMinutes * 60 * 1000;
    } catch (err) {
        log("Failed checking database staleness:", err);
        return false;
    }
}

// Handle browser startup event to ensure database freshness
if (browser.runtime && browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(async () => {
        log("Browser startup detected.");
        try {
            const config = await getConfig();
            const intervalMinutes = refreshIntervalMinutes(config);
            await scheduleAlarm(intervalMinutes);
            if (await isDatabaseStale()) {
                log("Database is stale on browser startup, refreshing providers with retry...");
                refreshAndScheduleRetry().catch((err) => {
                    log("Failed to refresh providers on browser startup:", err);
                });
            }
        } catch (err) {
            log("Startup check failed:", err);
        }
    });
}

// Ensure periodic alarm is scheduled, content scripts are registered, and database is checked on background script load
(async () => {
    try {
        const alarm = await browser.alarms.get(PULL_ALARM_NAME);
        const config = await getConfig();
        const intervalMinutes = refreshIntervalMinutes(config);
        if (!alarm) {
            await scheduleAlarm(intervalMinutes);
        }
        await updateDynamicContentScripts();
        if (await isDatabaseStale()) {
            log("Database is stale on script evaluation, refreshing providers with retry...");
            refreshAndScheduleRetry().catch((err) => {
                log("Failed to refresh providers on background script evaluation:", err);
            });
        }
    } catch (err) {
        log("Failed checking alarm, content scripts, and database status on script evaluation:", err);
    }
})();


// Listen to browser permission additions to synchronize model state
browser.permissions.onAdded.addListener(async (permissions) => {
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
browser.permissions.onRemoved.addListener(async (permissions) => {
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
