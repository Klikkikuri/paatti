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

    const img = document.createElement("img");
    img.src = browser().runtime.getURL("icons/klikkikuri-48.png");
    img.height = "48";
    img.classList.add("__klikkikuri-title-highlight")
    htmlElem.appendChild(img);
};

export const highlightElemOriginal = async (htmlElem) => {
    htmlElem.classList.remove("converted-title");
    htmlElem.removeChild(htmlElem.querySelector(".__klikkikuri-title-highlight"));

    restoreElemOriginalStyle(htmlElem);
};

export const extractArticleUrl = async (link) => {
    return link.href;
};

