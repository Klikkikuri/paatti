"use strict";

import  { model } from "./model.js";
import { browser } from "./utils.js";

export const getApiDataUrl = async () => {
    if (await model.read.isDevelopmentEnv()) {
        let testUrl = browser().runtime.getURL("test_data/data.json");
        if (!testUrl) {
            throw "DEVELOPMENT MODE: The `test_data/data.json` file evaluated to false. Have you initialized the test data with `python3 ./test_data/generate_data.py`?"
        }

        return testUrl;
    } else {
        return "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json";
    }
};

const storeElemOriginalStyle = (htmlElem) => {
    htmlElem.setAttribute("__klikkikuri_backgroundColor", htmlElem.style.backgroundColor);
    htmlElem.setAttribute("__klikkikuri_borderStyle", htmlElem.style.borderStyle);
    htmlElem.setAttribute("__klikkikuri_borderColor", htmlElem.style.borderColor);
    htmlElem.setAttribute("__klikkikuri_borderSize", htmlElem.style.borderSize);
};

const restoreElemOriginalStyle = (htmlElem) => {
    htmlElem.style.backgroundColor = htmlElem.getAttribute("__klikkikuri_backgroundColor");
    htmlElem.style.borderStyle = htmlElem.getAttribute("__klikkikuri_borderStyle");
    htmlElem.style.borderColor = htmlElem.getAttribute("__klikkikuri_borderColor");
    htmlElem.style.borderSize = htmlElem.getAttribute("__klikkikuri_borderSize");
};

export const noElementMatchesForQuerySelector = async (htmlElem) => {
    if (await model.read.getDebugVisualsEnabled()) {
        storeElemOriginalStyle(htmlElem);
        htmlElem.style.backgroundColor = "gray";
        htmlElem.style.borderStyle = "dashed";
        htmlElem.style.borderColor = "black";
        htmlElem.style.borderSize = "5px";
    } else {
        restoreElemOriginalStyle(htmlElem);
    }
};

export const noTitleMatchesForHash = async (htmlElem) => {
    if (await model.read.getDebugVisualsEnabled()) {
        storeElemOriginalStyle(htmlElem);
        htmlElem.style.backgroundColor = "orange";
        htmlElem.style.borderStyle = "solid";
        htmlElem.style.borderColor = "red";
        htmlElem.style.borderSize = "2px";
    } else {
        restoreElemOriginalStyle(htmlElem);
    }
};

export const highlightElemConverted = async (htmlElem) => {
    htmlElem.classList.add("converted-title");

    if (await model.read.getDebugVisualsEnabled()) {
        storeElemOriginalStyle(htmlElem);
        htmlElem.style.backgroundColor = "cyan";
        htmlElem.style.borderStyle = "groove";
        htmlElem.style.borderColor = "#0981D1";
        htmlElem.style.borderSize = "5px";
    } else {
        // TODO Remove possible debug visual BUT store the normal highlight.
        restoreElemOriginalStyle(htmlElem);
    }
};

export const highlightElemOriginal = async (htmlElem) => {
    htmlElem.classList.remove("converted-title");

    restoreElemOriginalStyle(htmlElem);
};

export const extractArticleUrl = async (link) => {
    return link.href;
};

