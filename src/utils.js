"use strict";

const browser = () => (chrome || browser);

const getLogger = (name) => {
    // CONFIG: Configure logging changing the values here.
    const doStackTrace = true;

    return (...args) => {
        const stacktracePart = doStackTrace ? `\nStack:\n${Error().stack}` : "";
        console.log(`[Loki ⛵ ${name}]:`, ...args, stacktracePart);
    };
};

const getCurrentTabHostname = async () => {
    const thisTabInfo = (await browser().tabs
        .query({ active: true, currentWindow: true }))[0];
    const thisTabUrl = new URL(thisTabInfo.url);

    return thisTabUrl.hostname;
};

export { getLogger, browser, getCurrentTabHostname };
