"use strict";

import { settingSavedDetail } from "./setting-message.js";

/**
 * @file component-utils.js
 * Helpers shared by the light-DOM components on the extension pages.
 *
 * Anything several components need, but which is not a component itself, belongs
 * here rather than being repeated or parked in one of them.
 *
 * ## Lifecycle
 *
 * A component that subscribes to anything extends `ComponentBase` and implements
 * `onConnect()`. Teardown is then the abort signal rather than bookkeeping: pass
 * `{ signal: this.signal }` to every addEventListener, and hand anything else that
 * needs undoing to `addTeardown()`. A component that subscribes to nothing has no
 * reason to extend it -- `HTMLElement` is fine.
 *
 * ## Styling
 *
 * A component whose CSS is shared with the rest of a page belongs in
 * components.css, styles.css or options.css as before. A component whose CSS is
 * nobody else's business can instead keep it in a stylesheet of its own, next to
 * the module, and pull it in from here:
 *
 *     import { adoptComponentStyleSheet } from './component-utils.js';
 *
 *     adoptComponentStyleSheet(new URL('./my-thing.css', import.meta.url));
 *
 * A page then gets the styling by importing the component and nothing else.
 * Colours still come from the tokens in theme.css, which the page loads.
 *
 * The badges in src/components do the same job with a constructable stylesheet
 * (see badge-style.js), which these components cannot use: they live in the
 * light DOM, so there is no shadow root to adopt into.
 */

/**
 * Load a component's own stylesheet into the host page, once per page.
 *
 * Resolve the URL in the calling module, against its own `import.meta.url` --
 * resolving it here would only ever point at this file. Calling twice is
 * harmless, which matters because two pages may import the same component.
 *
 * @param {URL|string} url - Absolute URL of the stylesheet to load.
 */
function adoptComponentStyleSheet(url) {
    const href = String(url);

    // Compare resolved hrefs rather than build an attribute selector: `link.href`
    // is already absolute, and a URL needs no escaping this way.
    const loaded = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .some((link) => link.href === href);
    if (loaded) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
}

/**
 * Register a custom element, unless the tag is already taken.
 *
 * Load-bearing rather than defensive: `make dist NON_OSS=1` overlays
 * assets/non-oss/by-kagi/src/ onto src/, so two definitions of a tag can both be
 * reachable and the second would throw.
 *
 * The badges in src/components keep an inline guard instead of calling this. They are
 * content-script reachable, and every module they import needs its own
 * `web_accessible_resources` entry -- see AGENTS.md.
 *
 * @param {string} tag - Custom element name.
 * @param {typeof HTMLElement} ctor - Class to register.
 */
function defineComponent(tag, ctor) {
    if (customElements.get(tag)) return;

    customElements.define(tag, ctor);
}

/**
 * Base for a light-DOM component that subscribes to anything.
 *
 * Owns connectedCallback and disconnectedCallback, so a subclass cannot forget to undo
 * what it set up. Subclasses implement `onConnect()` instead.
 */
class ComponentBase extends HTMLElement {
    #connection = null;

    /**
     * Aborted when the element leaves the page. Detached, this is an already-aborted
     * signal rather than null, so registering from a continuation that resolves late is
     * a no-op instead of a leak.
     *
     * @returns {AbortSignal}
     */
    get signal() {
        return this.#connection?.signal ?? AbortSignal.abort();
    }

    connectedCallback() {
        // A fresh controller per connection: connectedCallback runs again after a
        // re-attach, and a shared one would leave the element subscribed to nothing.
        this.#connection = new AbortController();
        this.onConnect();
    }

    disconnectedCallback() {
        this.#connection?.abort();
        this.#connection = null;
    }

    /**
     * Undo `fn` when this connection ends. For unsubscribes that are not event
     * listeners: what onConfigValue returns, or a storage.onChanged removal.
     *
     * @param {() => void} fn
     */
    addTeardown(fn) {
        const { signal } = this;
        // An aborted signal has already dispatched, so a listener added now would never
        // run. That is the leak this guards: a subscription set up after an `await` that
        // the element did not outlive still has to be undone.
        if (signal.aborted) {
            fn();
            return;
        }

        signal.addEventListener("abort", fn, { once: true });
    }

    /** Subclass hook, called by connectedCallback. Do not call super. */
    onConnect() {}
}

/**
 * Announce the result of writing a setting. Bubbles to whoever renders the status line.
 *
 * @param {HTMLElement} element - Dispatch target.
 * @param {Object} detail - See settingSavedDetail.
 */
function emitSettingSaved(element, detail) {
    element.dispatchEvent(new CustomEvent("setting-saved", {
        bubbles: true,
        detail: settingSavedDetail(detail),
    }));
}

export { adoptComponentStyleSheet, defineComponent, ComponentBase, emitSettingSaved };
