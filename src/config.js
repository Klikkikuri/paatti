"use strict";

export default {
    // CONFIG: Configure extension to start enabled here.
    "enabled": true,
    // CONFIG: Configure per-site settings here.
    "siteConfigs": {
        "www.iltalehti.fi": {
            // These CSS selectors are used to find the elements
            // containing text of news titles (which will be
            // converted).
            "linkTitleQuerySelectors": [
                ".front-title",
                ".title-container > .title,.title-container-most-read > .title",
                ".newsticker-title-text",
                ".latest-pala-video-overlay > .latest-pala-title"
            ],
            "enabled": false,
        },
        "www.hs.fi": {
            "linkTitleQuerySelectors": [
                "a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)",
            ],
            // These CSS selectors are used to find the elements
            // that might dynamically get added elements containing
            // convertable news titles (and need to be listened
            // for changes while the user is browsing the site).
            "mutationProneQuerySelectors": [
                "section.flex:nth-child(5) > section:nth-child(1)",
            ],
            "enabled": false,
        },
        "yle.fi": {
            "linkTitleQuerySelectors": [
                // This empty selector means that the a-tag selector (which is
                // used by default) will contain the needed title text.
                "",
            ],
            "enabled": false,
        },
        "www.aamulehti.fi": {
            "enabled": false,
        },
    },
    "environmentConfigs": {
        /* CONFIG: Un/comment these values to set dev mode on or off. */
        //"environment": "production",
        "environment": "development",
        "debugVisualsEnabled": false,
        // CONFIG: Configure default title data source URL here.
        "titleDataUrl": "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json",
    },
    "statistics": {},
};
