"use strict";

(async () => {
    const newsSite = window.location;
    const API_URL = "http://localhost:8000/assets/testData.json";
    const apiResponse = await fetch(API_URL);
    const data = await apiResponse.json();

    const site = data[newsSite.hostname];
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
        const linkHash = "1";
        const matcher = new RegExp(site.urlMatcher);
        if (newsSite.href.match(matcher) && site.conversions[linkHash]) {
            // TODO: Could/might want to select with a per-element selector
            // instead of a common per-site convention?
            titleElem = site.linkTitleQuerySelector
                ? link.querySelector(site.linkTitleQuerySelector)
                : link;
        }

        // Get the converted title.
        const siteKey = (new URL(newsSite.href)).hostname;
        const articleData = site.conversions[linkHash];
        const newTitle = articleData.title
            ?? site.conversions[articleData.canonical].title;

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
