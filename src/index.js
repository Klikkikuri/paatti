"use strict";

/* Configurations used per newssite */
const SITE_CONFIGS = {
    "www.iltalehti.fi": {
        "linkTitleQuerySelector": ".front-title"
    },
    "www.hs.fi": {
        "linkTitleQuerySelector": "a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)"
    },
    "yle.fi": {},
};

(async () => {
    const newsSite = window.location;
    const API_URL = "http://localhost:8000/assets/testData.json";
    const apiResponse = await fetch(API_URL);
    const titleData = (await apiResponse.json()).hashesToTitles;

    const site = SITE_CONFIGS[newsSite.hostname];
    if (site == undefined) {
        console.log(`'${newsSite.hostname}' is not supported.`);
        return;
    }
    console.log(`Casting our nets on ${newsSite.hostname}`);

    let failedLinks = [];
    for (const link of document.querySelectorAll("a")) {
        // Filter out the links not processed in backend.
        let titleElem;
        // TODO: Calculate real hash.
        const linkHash = Math.floor(Math.random() * 6);
        if (titleData[linkHash]) {
            // TODO: There might be more than just one way on a site to query
            // the text elements of the links.
            titleElem = site.linkTitleQuerySelector
                ? link.querySelector(site.linkTitleQuerySelector)
                : link;
        }

        // Get the converted title.
        const articleData = titleData[linkHash];
        const newTitle = articleData.title
            ?? titleData[articleData.canonical].title;

        if (!titleElem || !newTitle) {
            failedLinks.push({
                "href": link.href,
                "hash": linkHash
            });
            continue;
        }

        titleElem.textContent = newTitle;
    }

    // TODO: log error to some backend.
    console.log(`There were ${failedLinks.length} links not processed.`);
    console.log(failedLinks);
})();
