"use strict";

const getLogger = (name) => {
    // CONFIG: Configure logging changing the values here.
    const doStackTrace = true;

    return (...args) => {
        const stacktracePart = doStackTrace ? `\nStack:\n${Error().stack}` : "";
        console.log(`[Loki ⛵ ${name}]:`, ...args, stacktracePart);
    };
};

const isDevelopmentEnv = async () => {
    const environmentConfigs = (await browser.storage.local.get("environmentConfigs"))
        .environmentConfigs;
    return environmentConfigs.environment === "development";;
};

const getApiDataUrl = async () => {
    return (await isDevelopmentEnv())
        ? browser.runtime.getURL("test_data/data.json")
        : "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json";
};

const highlightElemError = async (htmlElem) => {
    if (await isDevelopmentEnv()) {
        htmlElem.style.backgroundColor = "orange";
        htmlElem.style.borderStyle = "dashed";
        htmlElem.style.borderColor = "red";
        htmlElem.style.borderSize = "5px";
    }
};

const highlightElemConverted = async (htmlElem) => {
    htmlElem.style.backgroundColor = "cyan";
    htmlElem.style.borderStyle = "groove";
    htmlElem.style.borderColor = "#0981D1";
    htmlElem.style.borderSize = "5px";
};
