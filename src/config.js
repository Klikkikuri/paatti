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
    "modifiers": {
        "aiSlop": true
    },

    // CONFIG: Configure per-site settings here.
    "siteConfigs": {
        "www.iltalehti.fi": {
            "name": "Iltalehti",
            "policyUrl": "https://www.iltalehti.fi/info/iltalehdesta",
            "origins": ["https://*.iltalehti.fi/*"],
            "enabled": true,
            "rules": [
                {
                    // Breaking / Ticker section on front page
                    "container": "div.newsticker > a.news-ticker-item",
                    "link": "self",
                    "title": "span.newsticker-title-text"
                },
                {
                    // Sidebar content
                    "container": "aside a.article-container",
                    "link": "self",
                    "title": "div.title"
                },
                {
                    // card on front page
                    "container": "main#main-content div.category-list div.card a",
                    "link": "self",
                    "title": "div.front-title"
                },
                {
                    // card on topic index page
                    "container": "main#main-content div.front div.card a",
                    "link": "self",
                    "title": "div.front-title"
                },
                {
                    // Article page; inline "Lue myös" links
                    "container": "article div.article-body div.related-article",
                    "link": "a",
                    "title": "a"
                },
                {
                    // Article page: "Lue myös", "Suosittelemme" links
                    "container": "article div.related-articles-list > a, article div.recommendations > a",
                    "link": "self",
                    "title": "div.title"
                },
                {
                    // Luetuimmat card
                    "container": "article div.card div.article-list > a",
                    "link": "self",
                    "title": "div.title"
                }

            ],
        },
        "www.hs.fi": {
            "name": "Helsingin Sanomat",
            "enabled": true,
            "origins": ["https://*.hs.fi/*"],
            "policyUrl": "https://www.hs.fi/info/art-2000006390609.html",
            "rules": [
                {
                    // Sidebar content: "Luetuimmat", "Uusimmat"
                    "container": "aside article ol > li",
                    "link": "a",
                    "title": "h3 span:last-child"
                },
                {
                    // Main frontpage content card
                    "container": "section[data-testid='main-lane-container'] article",
                    "link": ":scope > a[class*='block']",
                    "title": "h2 span:last-child"
                },
                {
                    // Main frontpage list card, e.g. "Tärkeimmät tänään"
                    "container": "section[data-testid='main-lane-container'] article > div > ol > li",
                    "link": ":scope > a",
                    "title": "h3 span:last-child"
                },
                {
                    // Article page; "Artikkeliin liittyvää"
                    "container": "section[data-testid='main-lane-container'] article .related-articles > a",
                    "link": ":scope",
                    "title": "h3 span:last-child"
                }
            ],
        },
        "yle.fi": {
            "name": "Yle",
            "enabled": true,
            "policyUrl": "https://yle.fi/a/3-11405388",
            "rules": [
                { // "Tuoreimmat" section on front page
                    "container": "aside li",
                    "title": "h3 a",
                    "link": "a[href*='/a/']",
                },
                {
                    // The main article wrapper
                    "container": "article.yle__article",
                    // We look for 'Avaa koko juttu' link at the bottom
                    "link": "section a[href^='/a/']:last-child",
                    // The target to replace is the H2 heading
                    "title": "header h2"
                },
                {
                    // Lyhyesti -scroller
                    "container": "aside[aria-labelledby=newsbriefly-heading] li a",
                    "link": "self",
                    "title": "self"
                },
                { // Pääuutiset cards
                    // The outermost wrapper that contains one full uutiskortti
                    container: "#yle__contentAnchor div[class*='GenericStory__GenericStoryBackground']",

                    // We target the link that contains the stable content-id attribute
                    // We also look for the ID in the URL as a fallback
                    link: "a[data-card-heading-content-id], a[href*='/a/']",

                    // The title is always the <h3> or the <a> inside the <h3>
                    title: "h3 a, h2 a"
                },
                {
                    // Frontpage featured story card (title over image / video)
                    container: "#yle__contentAnchor div[class*='FeatureStory__FeatureOverlay']",
                    link: "h2 a",
                    title: "h2 a"
                },
                {
                    // Paikallisuutiset -scroller carousel on front page
                    container: "ol > li div[class*='CarouselStory__Wrapper']",
                    link: "a[href*='/a/']",
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
            "policyUrl": "https://www.mtvuutiset.fi/artikkeli/mtv-uutisten-periaatteet-tekoalyn-hyodyntamisessa/9305164",
            // MTV uutiset uses react
            "rules": [
                {
                    // Section: Main news cards and teaser components on the frontpage and category pages
                    // Each individual news card is marked with this test id
                    "container": "[data-testid='teaser-content']",
                    "link": "a[data-testid='internal-link']",
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
                    // Front page big cards
                    "container": "div.container div.block > div.w-full > div:not(.vaihtuvamainos)",
                    "link": ":scope > a[href]",
                    "title": ":scope > h2.entry-title"
                },
                {
                    // Front page small cards
                    "container": "div.w-full > div:not(.vaihtuvamainos) h3 > a",
                    "link": "self",
                    "title": "self"
                },
                {
                    // Luetuimmat / Uusimmat
                    "container": "div.sivupalkkilistauksetsisalto ul li > a",
                    "link": "self",
                    "title": "self"
                },
                {
                    // "Aiheeseen liittyy"
                    "container": "div.jp-relatedposts a",
                    "link": "self",
                    "title": "self"
                },
                {
                    // Lue seuraavaksi
                    "container": "li.relevanssi_related_post",
                    "link": "a",
                    "title": "a"
                }
            ]
        },
        "www.ampparit.com": {
            "name": "Ampparit Uutispalvelut",
            "enabled": false,  // Optional
            "rules": [
                {
                    // Main list of news items on front page
                    "container": "article.item",
                    "link": ".item-title > a",
                    "title": ".item-title > a"
                },
                {
                    "container": "div.sidebox.popular .sidebox-content div.simple-item a[rel=\"noopener\"]",
                    "link": "self",
                    "title": "self"
                }
            ]
        // },
        // "old.reddit.com": {
        //     "name": "Reddit (old)",
        //     "enabled": false,  // Optional
        //     "rules": [
        //         {
        //             // Main list of posts on front page and subreddit pages
        //             "container": "div.linklisting div.entry",
        //             "link": "p.title a.title",
        //             "title": "p.title a.title"
        //         }
        //     ]
        }
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
                "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json",
                "http://localhost:3000/data.json"
            ],
            // "feedbackServerUrl": "http://localhost:3000/api/v1/feedback",
        },
    },
    "statistics": {},
};

let cachedConfig = null;
let pendingConfigPromise = null;
let isListenerRegistered = false;

function ensureListenerRegistered() {
    if (isListenerRegistered) return;
    isListenerRegistered = true;
    const browserStorage = browser()?.storage;
    if (browserStorage && browserStorage.onChanged) {
        browserStorage.onChanged.addListener((changes, areaName) => {
            log("Storage changed in area:", areaName, ". Invalidating config cache.");
            cachedConfig = null;
            pendingConfigPromise = null;
        });
    }
}

/**
 * Gets the merged configuration for the current environment.
 */
async function getConfig() {
    ensureListenerRegistered();
    if (cachedConfig) {
        return cachedConfig;
    }
    if (pendingConfigPromise) {
        return pendingConfigPromise;
    }

    const currentPromise = (async () => {
        const [localData, syncData] = await Promise.all([
            browser().storage.local.get("userPreferences"),
            browser().storage.sync.get(["userSiteOverrides", "modifiers"])
        ]);

        const userPreferences = localData.userPreferences || {};
        const syncOverrides = syncData.userSiteOverrides || {}; // Structure: { "yle.fi": false }
        const syncModifiers = syncData.modifiers || {};

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

        const finalConfig = {
            ...DEFAULT_CONFIG,
            ...userPreferences, // Overwrite defaults with user choices (e.g., "enabled": false)
            modifiers: {
                ...DEFAULT_CONFIG.modifiers,
                ...syncModifiers
            },
            environmentConfigs: mergedEnvConfigs,
            siteConfigs: mergedSiteConfigs, // Use properly merged site configs
            activeEnv: activeEnv,
            ...envData    // Flatten environment data (e.g., titleDataUrl) into the top level
        };

        // Cache the result only if the cache wasn't invalidated during the async call
        if (pendingConfigPromise === currentPromise) {
            cachedConfig = finalConfig;
            pendingConfigPromise = null;
        }

        return finalConfig;
    })();

    pendingConfigPromise = currentPromise;
    return pendingConfigPromise;
}

export { getConfig };
