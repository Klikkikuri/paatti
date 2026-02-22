"use strict";


const browser = () => (chrome || browser);

const getComplicatedLogger = (name) => {
    const logInitTime = Date.now();
    let lastLogTime = logInitTime;

    return (...xs) => {
        let doTimeDifference;
        // CONFIG: Comment or uncomment these in order to set different types of
        // logging TODO: Use some environment flags instead.
        const thisLogTime = Date.now();
        doTimeDifference = `⏱️ Δ ${((thisLogTime - lastLogTime) / 1000).toFixed(3)}s ∑ ${((thisLogTime - logInitTime) / 1000).toFixed(3)}s`;
        lastLogTime = thisLogTime;
        const message = `[ Loki ⛵ ${name} 🕰️ ${new Date(Date.now()).toISOString()}`;
        const args = [message, doTimeDifference, "]:"].filter((x) => x !== undefined);
        console.log.bind(console)(...args, ...xs);
    };
};

const getLogger = (name) => {
    // CONFIG: Switch the commenting of these different loggings if you like.
    //return getComplicatedLogger(name);
    return console.log.bind(console, `[Loki ⛵ ${name}]:`);
};

const getCurrentTabHostname = async () => {
    const thisTabInfo = (await browser().tabs
        .query({ active: true, currentWindow: true }))[0];
    const thisTabUrl = new URL(thisTabInfo.url);

    return thisTabUrl.hostname;
};

export { getLogger, browser, getCurrentTabHostname };
