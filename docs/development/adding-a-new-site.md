# Adding Support for a New Site

The site configurations are not in Paatti. They are in `sites.json` in the
[Rahti repository](https://github.com/Klikkikuri/rahti), which the official provider manifest links. At build time,
Paatti keeps a copy in [src/generated/sites.js](../../src/generated/sites.js) and takes the site origins of
[manifest.json](../../manifest.json) from it. The extension does not read this copy when it runs: it reads the sites
from its providers. Do not edit either file by hand.

---

## 1. Add the Site to Rahti's `sites.json`

Add an entry under `sites`, keyed by the host of the site. `docs/provider-manifest.md` in the Meri repository
describes the format.

```json
"www.example.com": {
    "name": "Example News",
    "description": "Notes about the site.",
    "enabled": false,
    "origins": ["https://www.example.com/*"],
    "links": [
        { "rel": "x-publisher-policy", "href": "https://www.example.com/policy" }
    ],
    "rules": [
        {
            "description": "Front page news cards",
            "container": "article.news-card",
            "link": "a.card-link",
            "title": "h3.card-title"
        }
    ]
}
```

- `enabled`: whether the site is on by default. A site that is off by default gets an optional host permission.
  `enabled: false` means "off by default", not "withdrawn": the site stays in the list, and the user can turn it on.
  A new site that is on by default gets a required host permission. When an installed extension updates to a release
  with a new required host permission, Chrome disables the extension until the user accepts the permission. Thus add a
  new site with `enabled: false`. An origin that was optional in the previous release stays optional, also after you
  set `enabled: true`: the site shows as off until the user grants access.
- `origins`: optional. The default is `https://<key>/*`. Each origin must have the host of the key; `*` is not
  permitted in the host.
- `links`: optional. `x-publisher-policy` shows as the publisher's policy link on the options page.
- `container`: CSS selector for each news card or link.
- `link`: selector, relative to the container, for the `<a>` element. Use `self` if the container is the link.
- `title`: selector, relative to the container, for the element that holds the headline. Use `self` if the
  container holds the text.
- `description`: optional, on the site and on a rule. It tells why the rule exists. Paatti does not use it.

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

## 2. Test the Site from a Local Rahti Checkout

Serve the Rahti checkout on the loopback address, and sync the bundled sites from it:

```bash
(cd ../rahti && python3 -m http.server 8000 --bind 127.0.0.1)
make sites-sync SITES_MANIFEST=http://127.0.0.1:8000/manifest.json
```

The sync resolves the manifest with the same validation that a provider gets at runtime, and stops if it refuses a
site. It also stops if a `site-configs` href is not in the directory of the manifest, so that the recorded Rahti
commit pins the sites too. It writes `src/generated/sites.js` and the site origins in `manifest.json`: `host_permissions` for an enabled
site, `optional_host_permissions` for a disabled site or an origin that was optional in the previous release, and the
`web_accessible_resources` matches for all sites. The previous release is the last `v*` tag before `HEAD`. Without
git history or tags, as in a source archive, the committed `manifest.json` takes its place.
Reload the unpacked extension to test.

`make test` fails while the bundled sites come from a local copy. That is intentional: do not commit them. A sync
from a local copy records no Rahti commit, and CI stops on it too.

---

## 3. Publish, Then Sync from the Published Manifest

Commit and push `sites.json` in Rahti. Then sync Paatti from the published manifest, run the tests, and commit
`src/generated/sites.js` and `manifest.json`:

```bash
make sites-sync
make test
```

`make test` includes `make check-sites`, which fails if `manifest.json` does not agree with the bundled sites. CI
compares the bundled sites with the Rahti commit that the sync recorded. [Bundled Sites](../release.md#bundled-sites)
tells which check runs where.
