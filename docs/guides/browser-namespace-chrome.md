#  Transition to browser namespace

From Chrome 148, all Chrome Extension APIs are available under the
`browser` namespace in addition to the existing `chrome` namespace. For
example, `browser.tabs.create({})` and `chrome.tabs.create({})` are
equivalent.

The namespace is available wherever you can call extension APIs, including
content scripts, service workers, and offscreen documents. It points to the
same API objects as `chrome`, so `chrome.tabs === browser.tabs`.

The `browser` namespace comes out of work in the
[WebExtensions Community Group (WECG)](https://www.w3.org/community/webextensions/),
a W3C community group where browser vendors collaborate on shared extension
standards. The `chrome` namespace is not going away; both namespaces will
continue to work.

> [!CAUTION]
> **Extensions with a DevTools page can't use the
> `browser` namespace.** If your extension declares a [devtools_page](https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools#creating), the `browser` namespace is turned off for the *entire
> extension* - not just the DevTools page, but also your service worker, content scripts, popup, options page, and any other context where extension APIs run. Continue to use `chrome.*` throughout these extensions. See [The
> browser namespace and DevTools extensions](https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools#browser-namespace) for why.

## Decide whether to adopt the browser namespace

If you're using
[webextension-polyfill](https://github.com/mozilla/webextension-polyfill),
skip ahead to [A note for polyfill users](https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace#polyfill) before changing anything
else - the answer is different for you.

If you're building a new extension, set
[`minimum_chrome_version`](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version)
to `"148"` and use `browser` unconditionally; you can stop reading here. The
rest of this section is for existing extensions deciding how to adopt.

### Check which Chrome versions your users are on

If you have an existing extension, check what versions of Chrome your users
are running before switching. Chrome auto-updates, but some users disable
updates and others are on older devices that can't run the latest version.
Confirm with your own analytics data. If you don't have analytics set up
yet, see
[Monitor your extension's performance with Google Analytics 4](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4)
to get started.

From there, pick a path:

- *If your users are on Chrome 148 or later* , [adopt unconditionally](https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace#unconditional).
- *If a meaningful portion of your users are on Chrome 147 or earlier* , [use the runtime guard](https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace#guard).

### Adopt unconditionally

Set [`minimum_chrome_version`](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version)
in your manifest and use `browser` unconditionally - no runtime guard needed:

    {
      "minimum_chrome_version": "148"
    }

> [!WARNING]
> **Setting `minimum_chrome_version` stops
> all updates for users on older Chrome.** The Chrome Web Store won't deliver any future version of your extension to users below the version you specify - they remain frozen at whatever version they have installed, and won't receive bug fixes, security patches, or new features unless they update Chrome. This is often the right call, but treat it as a deliberate decision, not a routine compatibility setting.

Use a staged rollout when raising `minimum_chrome_version`. If something
goes wrong, you can [roll back your extension](https://developer.chrome.com/docs/webstore/rollback) in
the Chrome Web Store.

### Use the runtime guard

Add the following snippet early in your extension's startup code before
referencing `browser` anywhere else:

    if (!globalThis.browser) {
      globalThis.browser = chrome;
      // Consider firing an analytics event here to measure how often
      // your users hit this fallback path.
    }

This makes `browser` an alias for `chrome` on earlier versions, so the rest of
your code can use `browser` unconditionally.

### A note for polyfill users

If your extension uses
[webextension-polyfill](https://github.com/mozilla/webextension-polyfill), it
becomes a no-op on Chrome 148 and later. The polyfill skipped wrapping when
`browser` was already defined, assuming the host browser had already provided
the API.

An earlier attempt to ship the namespace in Chrome 136 was rolled back for
this reason: with `browser` newly defined, the polyfill stopped wrapping, but
Chrome's `browser.runtime.onMessage` did not yet support promise-returning
listeners, which the polyfill had been providing. Extensions relying on that
pattern broke. Chrome 148 ships the namespace and native promise-returning
`onMessage` listeners together to avoid that gap.

You can remove the polyfill dependency once your user base has moved to
Chrome 148.

## Other features

### Async responses in runtime.sendMessage

In Chrome 148, `runtime.onMessage` listeners can return a `Promise` directly
to send an async response. This works whether you call it using `chrome.*` or
`browser.*`.

Previously the only way to respond asynchronously was to return a literal
`true` from the listener and call `sendResponse` later:

    // Old pattern - requires returning true to keep the channel open
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      fetch('https://example.com')
        .then(response => sendResponse({ statusCode: response.status }));

      return true; // keeps the message channel open for the async response
    });

You can now return a `Promise` (or use an `async` function) directly:

    // New pattern - return a promise or use async/await
    browser.runtime.onMessage.addListener(async (message, sender) => {
      const response = await fetch('https://example.com');
      return { statusCode: response.status };
    });

The `return true` pattern continues to work, so existing code doesn't need to
change.

> [!NOTE]
> As with the `browser` namespace itself, `runtime.onMessage` Promise responses are not available in extensions that declare a [devtools_page](https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools#browser-namespace).