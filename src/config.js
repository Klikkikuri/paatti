"use strict";

import { browser, getLogger } from "./utils.js";

const log = getLogger("config");

const DEFAULT_ENV = {
    "debugVisualsEnabled": false,
    "refreshIntervalMinutes": 20,
    "titleDataUrls": ["https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"],
}

const DEFAULT_CONFIG = {
    // CONFIG: Configure extension to start enabled here.
    "enabled": true,

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
                
                { // Lyhyesti
                    // The main article wrapper
                    "container": "article.yle__article",
                    
                    // We look for the ID in the 'Avaa koko juttu' link at the bottom
                    "link": "a[href*='/a/']",
                    
                    // The target to replace is the main H1 heading
                    "title": "h1"
                },
                { // Pääuutiset cards
                    // The outermost wrapper that contains one full uutiskortti
                    container: "[class*='GenericStory__GenericStoryBackground'], [class*='Card__StyledImpressionTrigger']",
                    
                    // We target the link that contains the stable content-id attribute
                    // We also look for the ID in the URL as a fallback
                    link: "a[data-card-heading-content-id], a[href*='/a/']",
                    
                    // The title is always the <h3> or the <a> inside the <h3>
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
                    // Each individual news card is marked with this test id
                    "container": "[data-testid='article-teaser-component']",
                    
                    // The specific link that contains the article ID
                    "link": "a[data-testid^='teaser-link-']",
                    
                    // The headline is an h2 inside the content area
                    "title": "h2"
                },
                { // Ticker list at the top of frontpage
                    "container": "ul[data-testid='news-ticker-component'] li",
                    
                    // The link containing the unique numeric ID (9280388)
                    "link": "a[data-testid='internal-link']",
                    
                    // The headline element to be replaced
                    "title": "span.typography-title-4"
                },
                {
                    // Targets the specific list item component
                    "container": "ul li[data-testid='article-media-list-item-component']",
                    
                    // Finds the link containing the unique article ID
                    "link": "a[data-testid='internal-link']",
                    
                    // In this list format, the title is an H3
                    "title": "h3"
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
        "free": {...DEFAULT_ENV,
            "debugVisualsEnabled": false,
            "titleDataUrls": ["https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"],
        },
        "development": {...DEFAULT_ENV,
            "debugVisualsEnabled": true,
            "refreshIntervalMinutes": 1,
            "titleDataUrls": [
                "http://localhost:3000/data.json",
                "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"
            ],
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

    const activeEnv = userPreferences.environment || DEFAULT_CONFIG.environment;

    const envData = DEFAULT_CONFIG.environmentConfigs[activeEnv];

    const mergedSiteConfigs = { ...DEFAULT_CONFIG.siteConfigs };
    for (const [domain, siteConfig] of Object.entries(mergedSiteConfigs)) {
        // Merge siteConfigs with sync overrides
        if (syncOverrides.hasOwnProperty(domain)) {
            log("Applying sync override for", domain, "to", syncOverrides[domain]);
            const overrides = syncOverrides[domain]
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
        siteConfigs: mergedSiteConfigs, // Use properly merged site configs
        activeEnv: activeEnv,
        ...envData    // Flatten environment data (e.g., titleDataUrl) into the top level
    };
}

export { getConfig };
