"use strict";

import  { model } from "./model.js";
import { browser } from "./utils.js";

export const getApiDataUrl = async () => {
    return (await model.read.isDevelopmentEnv())
        ? browser().runtime.getURL("test_data/data.json")
        : "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json";
};

export const storeElemHightlight = (htmlElem) => {
    htmlElem.setAttribute("__klikkikuri_backgroundColor", htmlElem.style.backgroundColor);
    htmlElem.setAttribute("__klikkikuri_borderStyle", htmlElem.style.borderStyle);
    htmlElem.setAttribute("__klikkikuri_borderColor", htmlElem.style.borderColor);
    htmlElem.setAttribute("__klikkikuri_borderSize", htmlElem.style.borderSize);
};

export const noElementMatchesForQuerySelector = async (htmlElem) => {
    if (await model.read.isDevelopmentEnv()) {
        storeElemHightlight(htmlElem);
        htmlElem.style.backgroundColor = "gray";
        htmlElem.style.borderStyle = "dashed";
        htmlElem.style.borderColor = "black";
        htmlElem.style.borderSize = "5px";
    }
};

export const noTitleMatchesForHash = async (htmlElem) => {
    if (await model.read.isDevelopmentEnv()) {
        storeElemHightlight(htmlElem);
        htmlElem.style.backgroundColor = "orange";
        htmlElem.style.borderStyle = "solid";
        htmlElem.style.borderColor = "red";
        htmlElem.style.borderSize = "2px";
    }
};

export const highlightElemConverted = async (htmlElem) => {
    storeElemHightlight(htmlElem);
    htmlElem.style.backgroundColor = "cyan";
    htmlElem.style.borderStyle = "groove";
    htmlElem.style.borderColor = "#0981D1";
    htmlElem.style.borderSize = "5px";
};

export const highlightElemOriginal = async (htmlElem) => {
    htmlElem.style.backgroundColor = htmlElem.getAttribute("__klikkikuri_backgroundColor");
    htmlElem.style.borderStyle = htmlElem.getAttribute("__klikkikuri_borderStyle");
    htmlElem.style.borderColor = htmlElem.getAttribute("__klikkikuri_borderColor");
    htmlElem.style.borderSize = htmlElem.getAttribute("__klikkikuri_borderSize");
};

export const extractArticleUrl = async (link) => {
    if (await model.read.isDevelopmentEnv()) {
        if (!testUrls) {
            throw "DEVELOPMENT MODE: The `testUrls` variable evaluated to false. Have you initialized the test data with `python3 ./test_data/generate_data.py`?"
        }

        const i = Array.from(link.href)
            .reduce((sum, charStr) => sum + charStr.charCodeAt(0), 0)
            % 6;
        return testUrls[i];
    } else {
        return link.href;
    }
};

