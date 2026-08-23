"use strict";

/**
 * @file component-utils.js
 * Helpers shared by the light-DOM components on the extension pages.
 *
 * Anything several components need, but which is not a component itself, belongs
 * here rather than being repeated or parked in one of them.
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

export { adoptComponentStyleSheet };
