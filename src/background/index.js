"use strict";

import { getLogger } from "../utils.js";
import { model } from "../model.js";
import { controller } from "../controller.js";

const log = getLogger("background");

chrome.runtime.onInstalled.addListener(async () => {
    await controller.initialize()
    log("Installed Paatti with initial configuration:", await model.read.toString());
});
