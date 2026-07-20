# Adding Support for a New Site

To add support for a new news website in Klikkikuri Paatti, follow these three steps:

---

## 1. Configure the Site Rules in `src/config.js`

Add a new configuration entry under `DEFAULT_CONFIG.siteConfigs` in [src/config.js](../../src/config.js).

```javascript
"www.example.com": {
    "name": "Example News",
    "enabled": true, // Whether the site is enabled by default
    "origins": ["https://*.example.com/*"], // Optional; defaults to key if omitted
    "rules": [
        {
            // CSS selector matching the container element for each news article card/link
            "container": "article.news-card", 
            
            // Relative selector from the container to the <a> tag (use "self" if the container is the link)
            "link": "a.card-link", 
            
            // Relative selector from the container to the text element holding the headline (use "self" if the link is the text element)
            "title": "h3.card-title" 
        }
    ]
}
```

### Selector Rules & Syntax Guidelines

*   **Only CSS Selectors are Supported**: The extension uses standard browser DOM methods (`querySelector` and `querySelectorAll`) to query page elements. **XPath is not supported**. When copying paths from browser Developer Tools, make sure you choose **Copy selector** / **Copy CSS path**, and *not* Copy XPath.
    *   *Reference*: See [MDN CSS Selectors Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors) for more details on general CSS selector types and combinators.

*   **Special Selectors**:
    *   **`"self"`**: Used in `link` or `title` when the target element is the same node as the parent reference:
        *   If the `container` itself is the `<a>` link element, set `link: "self"`.
        *   If the target `link` element itself is the node containing the headline text (with no inner element), set `title: "self"`.
    *   **`":scope"`**: By default, relative DOM queries (`container.querySelectorAll("a")`) will search *all nested descendants* inside the container. If you want to restrict the search to direct children or specific sub-trees relative only to the container itself, prepend the `:scope` pseudo-class (e.g. `:scope > a` to only match immediate child anchors).
        *   *Reference*: See [MDN :scope Pseudo-class Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/:scope) for details on scoping elements.

---

## 2. Update `manifest.json` Permissions

Update [manifest.json](file:///home/teemu/projects/klikkikuri/paatti/manifest.json) to declare the new site origins:

1. **Permissions**: 
   - Add the origin (e.g. `https://*.example.com/*`) to `host_permissions` if the site is enabled by default (`enabled: true` or omitted).
   - Add it to `optional_host_permissions` if the site is disabled by default / optional (`enabled: false`).
2. **Web Accessible Resources**:
   - Add the origin to the `matches` array in the `web_accessible_resources` block. This is **required** to allow dynamic ES module imports (`src/model.js`, etc.) to load inside the site's content script context.

---

## 3. Verify Alignments

Run the test suite to ensure that your site configurations in `config.js` and permissions in `manifest.json` are fully aligned:

```bash
make test
```
