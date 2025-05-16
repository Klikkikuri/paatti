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

const storeElemHightlight = (htmlElem) => {
    htmlElem.setAttribute("__klikkikuri_backgroundColor", htmlElem.style.backgroundColor);
    htmlElem.setAttribute("__klikkikuri_borderStyle", htmlElem.style.borderStyle);
    htmlElem.setAttribute("__klikkikuri_borderColor", htmlElem.style.borderColor);
    htmlElem.setAttribute("__klikkikuri_borderSize", htmlElem.style.borderSize);
};

const noElementMatchesForQuerySelector = async (htmlElem) => {
    if (await isDevelopmentEnv()) {
        storeElemHightlight(htmlElem);
        htmlElem.style.backgroundColor = "gray";
        htmlElem.style.borderStyle = "dashed";
        htmlElem.style.borderColor = "black";
        htmlElem.style.borderSize = "5px";
    }
};

const noTitleMatchesForHash = async (htmlElem) => {
    if (await isDevelopmentEnv()) {
        storeElemHightlight(htmlElem);
        htmlElem.style.backgroundColor = "orange";
        htmlElem.style.borderStyle = "solid";
        htmlElem.style.borderColor = "red";
        htmlElem.style.borderSize = "2px";
    }
};

const highlightElemConverted = async (htmlElem) => {
    storeElemHightlight(htmlElem);
    htmlElem.style.backgroundColor = "cyan";
    htmlElem.style.borderStyle = "groove";
    htmlElem.style.borderColor = "#0981D1";
    htmlElem.style.borderSize = "5px";
};

const highlightElemOriginal = async (htmlElem) => {
    htmlElem.style.backgroundColor = htmlElem.getAttribute("__klikkikuri_backgroundColor");
    htmlElem.style.borderStyle = htmlElem.getAttribute("__klikkikuri_borderStyle");
    htmlElem.style.borderColor = htmlElem.getAttribute("__klikkikuri_borderColor");
    htmlElem.style.borderSize = htmlElem.getAttribute("__klikkikuri_borderSize");
}
