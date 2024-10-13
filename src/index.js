"use strict";

(() => {
    // TODO: Fetch the headline data from the backend here.
    let conversions = {
        "iltalehti.fi": { "titles": {} },
        "hs.fi":        { "titles": {} },
        "yle.fi":       { "titles": {} },
    };

    for (let link of document.querySelectorAll("a")) {
        let titleElem;
        if (window.location.href.match(/https:\/\/.*.iltalehti.fi\/.*/)) {
            console.log("Processing Iltalehti");
            titleElem = link.querySelector(".front-title");
        } else if (window.location.href.match(/https:\/\/*.*hs.fi\/*/)) {
            console.log("Processing HS");
            titleElem = link.querySelector("a:nth-child(1) > section:nth-child(1) > div:nth-child(1) > div:nth-child(1) > h2:nth-child(1) > span:nth-child(2)");
        } else if (window.location.href.match(/https:\/\/yle.fi\/*/)) {
            console.log("Processing Yle");
            titleElem = link;
        } else {
            console.log(`'${window.location.href}' is not supported.`);
        }
        if (!titleElem) { continue; }

        // TODO: Check for converted title here.
        let newTitle = "Paatin nappaama";
        if (!newTitle) { continue; }

        titleElem.textContent = newTitle;
    }
})();
