"use strict";

import { model } from "./model.js";
import { browser } from "./utils.js";

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
    // TODO: Use this to highlight the thing if needed.
    restoreElemOriginalStyle(htmlElem);
};

export const noTitleMatchesForHash = async (htmlElem) => {
    // TODO: Use this to highlight the thing if needed.
    restoreElemOriginalStyle(htmlElem);
};

export const highlightElemConverted = async (htmlElem) => {
    htmlElem.classList.add("converted-title");
};

export const highlightElemOriginal = async (htmlElem) => {
    htmlElem.classList.remove("converted-title");

    restoreElemOriginalStyle(htmlElem);
};

export const extractArticleUrl = async (link) => {
    return link.href;
};

