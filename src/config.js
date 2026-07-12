"use strict";

import { browser, getLogger } from "./utils.js";

const log = getLogger("config");

const DEFAULT_ENV = {
    "refreshIntervalMinutes": 20,
    "email": "",
    "titleDataUrls": ["https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"],
    "feedbackServerUrl": "https://docs.google.com/forms/d/e/1FAIpQLSf_vo9tpXAjbP1JyhNlgRdPnpPD1K3w6aPfern_jZfJVcHtCw/formResponse",
}

const DEFAULT_CONFIG = {
    // CONFIG: Configure extension to start enabled here.
    "enabled": true,
    "environment": "free",

    // CONFIG: Configure per-site settings here.
    "siteConfigs": {
        "www.iltalehti.fi": {
            "name": "Iltalehti",
            "origins": ["https://*.iltalehti.fi/*"],
            "enabled": false,
            "rules": [
            ],
        },
        "www.hs.fi": {
            "name": "Helsingin Sanomat",
            "enabled": false,
            "origins": ["https://*.hs.fi/*"],
            "rules": [
            ],
        },
        "yle.fi": {
            "name": "Yle",
            "enabled": true,
            "rules": [
                { // "Tuoreimmat" section on front page
                    "container": "aside li",
                    "title": "h3 a",
                    "link": "a[href*='/a/']",
                },

                { // Lyhyesti tab
                    // The main article wrapper
                    "container": "article.yle__article",

                    // We look for the ID in the 'Avaa koko juttu' link at the bottom
                    "link": "section a[href*='/a/']",

                    // The target to replace is the H2 heading
                    "title": "header h2"
                },
                { // Pääuutiset cards
                    // The outermost wrapper that contains one full uutiskortti
                    container: "[class*='GenericStory__GenericStoryBackground'], [class*='Card__StyledImpressionTrigger']",

                    // We target the link that contains the stable content-id attribute
                    // We also look for the ID in the URL as a fallback
                    link: "a[data-card-heading-content-id], a[href*='/a/']",

                    // The title is always the <h3> or the <a> inside the <h3>
                    title: "h3 a"
                },
                { // Aiheesta enemmän cards
                    container: "[class*='yle__article__links']",
                    link: "a[data-card-heading-content-id], a[href*='/a/']",
                    title: "h3 a"
                }
            ],
        },
        "www.mtvuutiset.fi": {
            "name": "MTV Uutiset",
            "enabled": true,
            // MTV uutiset uses react
            "rules": [
                {
                    // Section: Main news cards and teaser components on the frontpage and category pages
                    // Each individual news card is marked with this test id
                    "container": "[data-testid='article-teaser-component'], [data-testid='teaser-content']",
                    "link": "a[data-testid^='teaser-link-'], a[data-testid='internal-link']",
                    "title": "h2"
                },
                {
                    // Section: Horizontal/vertical news ticker widget at the top of the frontpage (e.g. data-testid='news-ticker-component')
                    // Ticker list at the top of frontpage
                    "container": "ul[data-testid='news-ticker-component'] li",
                    "link": "a[data-testid='internal-link']",
                    "title": "span[class*='typography-title']"
                },
                {
                    // Section: MTV Uutiset Nyt (newsfeed) feed carousel at the top of the frontpage
                    // Ticker list (newsfeed) at the top of frontpage
                    "container": "li[data-testid='newsfeed-list-item']",
                    "link": "a[data-testid='internal-link']",
                    "title": "span[data-testid='newsfeed-item-title'], span[class*='typography-subtitle']"
                },
                {
                    // Section: "Tuoreimmat aiheesta" (Latest on topic) list shown under article pages
                    "container": "ul[data-testid='unordered-list'] li",
                    "link": "a[data-testid='internal-link']",
                    "title": "h3"
                },
                {
                    // Section: "Lisää aiheesta" (More on topic) suggestions links under/in articles
                    // The link element is the container itself
                    "container": "[data-testid='article-suggestions-component'] a[data-testid='internal-link']",
                    "link": "self",
                    "title": "self"
                },
                {
                    // Section: Video gallery/carousel list items shown on video section pages (e.g. "Enemmän katsottavaa")
                    "container": "[data-testid='video-gallery-list-item-view-component']",
                    "link": "a[data-testid='internal-link']",
                    "title": "h2[data-testid='video-title']"
                },
                {
                    // In-body links to other articles (e.g. "Lue myös" links)
                    "container": "div.article-text a[data-testid='internal-link'][role='link']",
                    "link": "self",
                    "title": "self"
                },
                {
                    // Uutisvirta -page
                    "container": "div.segment-uutisvirta section:has(h1) ul > li",
                    "title": "h2",
                    "link": "a[data-testid='internal-link'][role='link']"
                }
            ]
        },
        "aksa.fi": {
            "name": "Äänekosken Kaupunkisanomat",
            "enabled": true,
            "rules": [
                {
                    "container": "div.border-b.border-gray",
                    "link": "a[href]",
                    "title": "h3.robotoc a"
                },
                {
                    "container": "div.sivupalkkilistauksetsisalto ul > li",
                    "link": "a[href]",
                    "title": "a"
                },
                {
                    // Käytetään h2:sta ankkurina, koska se on vakain osa uutisrakennetta
                    container: "h2.entry-title",

                    // Etsitään linkki h2:n sisältä
                    link: "a",

                    // Otsikko on h2:n sisällä oleva linkki (tai h2 itse)
                    title: "a, self"
                }
            ]
        },
    },

    "environmentConfigs": {
        "free": {
            ...DEFAULT_ENV,
            "titleDataUrls": ["https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"],
        },
        "paid": {
            ...DEFAULT_ENV,
            "debugVisualsEnabled": false,
            "refreshIntervalMinutes": 10,
            "email": "",
        },
        "development": {
            ...DEFAULT_ENV,
            "debugVisualsEnabled": true,
            "refreshIntervalMinutes": 1,
            "titleDataUrls": [
                "http://localhost:3000/data.json",
                "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"
            ],
            // "feedbackServerUrl": "http://localhost:3000/api/v1/feedback",
        },
    },
    "statistics": {},
};

/**
 * Gets the merged configuration for the current environment.
 */
async function getConfig() {
    const [localData, syncData] = await Promise.all([
        browser().storage.local.get("userPreferences"),
        browser().storage.sync.get("userSiteOverrides")
    ]);

    const userPreferences = localData.userPreferences || {};
    const syncOverrides = syncData.userSiteOverrides || {}; // Structure: { "yle.fi": false }

    const activeEnv = userPreferences.environment || DEFAULT_CONFIG.environment || "free";

    // Merge environment configs to avoid overwriting defaults
    const mergedEnvConfigs = {};
    const environments = ["free", "paid", "development"];
    for (const env of environments) {
        mergedEnvConfigs[env] = {
            ...DEFAULT_CONFIG.environmentConfigs[env],
            ...(userPreferences.environmentConfigs?.[env] || {})
        };
    }

    const envData = mergedEnvConfigs[activeEnv];

    const mergedSiteConfigs = { ...DEFAULT_CONFIG.siteConfigs };
    for (const [domain, siteConfig] of Object.entries(mergedSiteConfigs)) {
        // Merge siteConfigs with sync overrides
        if (syncOverrides.hasOwnProperty(domain)) {
            const overrides = syncOverrides[domain]
            log("Applying sync override for", domain, "to", overrides);
            mergedSiteConfigs[domain] = {
                ...siteConfig,
                ...overrides
            };
        }

        // If origins are not set, add a default pattern
        if (!siteConfig.origins) {
            siteConfig.origins = [`https://${domain}/*`];
        }
    }

    // Return the merged final config
    return {
        ...DEFAULT_CONFIG,
        ...userPreferences, // Overwrite defaults with user choices (e.g., "enabled": false)
        environmentConfigs: mergedEnvConfigs,
        siteConfigs: mergedSiteConfigs, // Use properly merged site configs
        activeEnv: activeEnv,
        ...envData    // Flatten environment data (e.g., titleDataUrl) into the top level
    };
}

export { getConfig };
