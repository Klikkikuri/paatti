"use strict";


const browser = () => (chrome || browser);

const getComplicatedLogger = (name) => {
    const logInitTime = Date.now();
    let lastLogTime = logInitTime;

    return (...xs) => {
        let doLogTime;
        let doTimeDifference;
        let doCumulativeTime;

        const thisLogTime = Date.now();

        // CONFIG: Comment or uncomment these in order to set different types of
        // logging TODO: Use some environment flags instead.
        //doLogTime = `🕰️ ${new Date(Date.now()).toISOString()}`
        //doTimeDifference = `Δ ${((thisLogTime - lastLogTime) / 1000).toFixed(3)}s`;
        doCumulativeTime = `∑ ${((thisLogTime - logInitTime) / 1000).toFixed(3)}s`;

        lastLogTime = thisLogTime;

        const logPrompt = `Loki ⛵ ${name.padEnd(10)}`;
        const args = [
            logPrompt,
            doLogTime,
            ((doTimeDifference || doCumulativeTime) ? "⏱️" : undefined),
            doTimeDifference,
            doCumulativeTime,
            ">",
        ].filter((x) => x !== undefined);
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
