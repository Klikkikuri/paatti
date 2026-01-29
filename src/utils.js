"use strict";

const browser = () => (chrome || browser);

const getLogger = (name) => {
    return console.log.bind(console, `[Loki ⛵ ${name} 🕰️ ${Date.now()}]:`);
};

const getCurrentTabHostname = async () => {
    const thisTabInfo = (await browser().tabs
        .query({ active: true, currentWindow: true }))[0];
    const thisTabUrl = new URL(thisTabInfo.url);

    return thisTabUrl.hostname;
};

export { getLogger, browser, getCurrentTabHostname };
