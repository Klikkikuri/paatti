// A jsdom document on globalThis, so a component module can be imported and its lifecycle
// exercised under `make test`.
//
// jsdom is installed globally (see .devcontainer/Dockerfile). ESM resolution ignores
// NODE_PATH, so it is reached through the CJS resolver, which honours it; the `test` target
// in the Makefile sets NODE_PATH from `npm root -g`.
//
// Install the DOM BEFORE the dynamic `await import(...)` of the component. A component module
// builds its <template> and calls customElements.define at evaluation time, so a static import
// would be hoisted above the install and run with no `document`. Same rule as fake-browser.mjs.
//
//     const dom = installDom();
//     globalThis.browser = createFakeBrowser().browser;
//     await import("../src/options/components/toggle-button.js");
//     ...
//     dom.teardown();
//
// jsdom's own AbortController is exposed, not Node's: a signal handed to jsdom's
// addEventListener has to come from the same realm, or the registration is rejected.
//
// This module runs no top-level code beyond resolving jsdom, so a runner that picks it up
// finds no tests.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

/** What a component module touches at evaluation time or during its lifecycle. */
const EXPOSED = [
    "window",
    "document",
    "customElements",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "DOMParser",
    "AbortController",
    "AbortSignal",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
];

/**
 * Put a fresh jsdom document on globalThis.
 *
 * Each call builds a new JSDOM, so each suite gets its own customElements registry -- a
 * registry is per-window, and defining the same tag twice in one throws.
 *
 * @param {Object} [options]
 * @param {string} [options.html] - Starting document.
 * @param {string} [options.url] - Document URL; `import.meta.url` resolution needs an http(s) origin.
 * @returns {{window: Object, document: Object, teardown: () => void}}
 */
function installDom({ html = "<!doctype html><html><body></body></html>", url = "https://localhost/" } = {}) {
    const dom = new JSDOM(html, { url, pretendToBeVisual: true });
    const { window } = dom;

    const saved = new Map();
    for (const name of EXPOSED) {
        saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        const value = name === "window" ? window : window[name];
        // Bound, because the DOM functions throw when called with the wrong receiver.
        Object.defineProperty(globalThis, name, {
            value: typeof value === "function" && !value.prototype ? value.bind(window) : value,
            configurable: true,
            writable: true,
        });
    }

    return {
        window,
        document: window.document,
        teardown() {
            for (const [name, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete globalThis[name];
            }
            window.close();
        },
    };
}

/**
 * Dispatch an event with `isTrusted` set, as the browser does for a real user's input. A script can only
 * dispatch untrusted events, so this goes through jsdom internals; a jsdom upgrade can move them.
 *
 * @param {EventTarget} target
 * @param {string} type
 * @param {Object} [init] - Event init dictionary, for example `{ key: "Enter", bubbles: true }`.
 * @param {string} [kind] - jsdom interface name, for example "MouseEvent" or "KeyboardEvent".
 * @returns {boolean} False when a listener cancelled the event.
 */
function dispatchTrusted(target, type, init = {}, kind = "Event") {
    const { tryImplForWrapper } = require("jsdom/lib/jsdom/living/generated/utils");
    const { createAnEvent } = require("jsdom/lib/jsdom/living/helpers/events");
    const impl = tryImplForWrapper(target);
    return impl._dispatch(createAnEvent(type, impl._globalObject, require(`jsdom/lib/jsdom/living/generated/${kind}`), init));
}

export { installDom, dispatchTrusted };
