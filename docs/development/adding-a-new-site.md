# Adding Support for a New Site

The site configurations are not in Paatti. They are in `sites.json` in the
[Rahti repository](https://github.com/Klikkikuri/rahti), which the default provider manifest links. The extension
reads the sites from its providers when it runs. Paatti keeps only the origins of the default sites, in
[manifest.json](../../manifest.json) and [sites.lock.json](../../sites.lock.json), because a store build can request
only the origins that `manifest.json` declares. `make sites-sync` writes both files. Do not edit them by hand.

A new site can need two kinds of rules:

- **Site rules** in Rahti's `sites.json`: CSS selectors that find the headlines and their links on the page.
- **A Suola rule** in [suola/rules.yaml](../../suola/rules.yaml), when the default rule does not give one address
  for each article. Paatti finds a correction by a sign: a hash of the article's address, made with the Suola rules.

Develop both with the development server (step 1), then publish them (steps 2–4).

---

## 1. Develop the Rules with the Development Server

The [captured-sites provider](../../packages/karikko/README.md#captured-sites) of the development server keeps each site
that you capture in a folder, `test_data/captures/<host>/`. You edit the rules in that folder, and the server gives
each link a test correction, so the page shows which headlines the rules find.

| File | What you do with it |
| --- | --- |
| `sites.json` | Edit the site rules (the CSS selectors). |
| `rules.json` | Add a Suola rule, if the site needs one. |
| `links.json` | The links that you captured. Delete the file to remove them. |
| `data.json` | The test corrections. The server writes it. Do not edit it. |

### 1.1 Set up

1. Start the server with `make serve`, then start the extension with `./run.sh`. `./run.sh` adds the captured-sites
   provider. To add it by hand, see [Development Server](../../README.md#development-server).
2. Keep **Allow providers to override sites** on. It is on by default in the `development` environment. If it is
   off, Paatti does not use your folder for a site that Rahti already supplies.

### 1.2 Capture the page

1. Open the front page of the site.
2. Open the popup, and select **Send page** under **Developer Settings**. If the browser asks for the permission of
   the site, accept it. If the popup closes, open it and select **Send page** again.

The server makes the folder `test_data/captures/<host>/`. The host is the punycode spelling (`www.ähti.fi` becomes
`www.xn--hti-pla.fi`), which is also how the browser sends the page address. A page at an address that no browser can
visit, so with no host, is refused with `HTTP 422` and stores nothing. On a site that no provider supplies, `sites.json`
gets a rule that takes each link with text: each link on the page then shows a correction that starts with `[dev]`.

The content features of the server also apply to the captured links, so by default some links show no `[dev]`
correction: a low level, a paywall, or no entry. While you write the rules, start the server without these cases:

```sh
make serve DEVSERVER_ARGS="--features.levels=false --features.paywalled=false --features.no_entry=false"
```

Start it with the defaults again to see how the site shows each case.

### 1.3 Write the site rules

1. In `sites.json`, change `rules` so that they find only the headlines. Write each rule as in
   [Selector Rules & Syntax Guidelines](#selector-rules--syntax-guidelines). Use the browser's developer tools to
   find the selectors.
2. On the extension's settings page, select **Update Database**, then reload the page. Each headline that the
   rules find shows a `[dev]` correction. A headline without one is not found. If no headline on the page shows a
   `[dev]` correction, reload it again: a page that loads while the extension updates its sites gets no content
   script.
3. Select **Send page** again. The server adds the links that the new rules find. To remove the links that the first
   rule found, delete `links.json` before you send the page.

A capture does not change `sites.json` after the first capture, so your changes stay.

### 1.4 Write a Suola rule, if the site needs one

The default Suola rule keeps the host and the path, and removes the query and the trailing slashes. Write a rule
for the site when this is not correct, for example when:

- the query identifies the article;
- one article has more than one path;
- a part of the path changes its letter case;
- a list page must not get the same sign as an article.

1. Write the rule in `rules.json`, in the format of [suola/README.md](../../suola/README.md#signature-rules-rulesyaml),
   but as JSON. Add `tests`: for each form of the article address, give the `url` and the `expected` address. Add a
   list page with `xfail: true`.
   - Suola compares `domain` with `host:port`. A site on a port, such as `localhost:3000`, needs the port in the
     domain.
   - To change a site that `suola/rules.yaml` already has, use the same `domain`. Your rule then replaces that rule.
   - A rule for a parent domain, for example `example.fi`, also applies to the subdomains of your other folders.
2. Select **Update Database**. The server signs the links again with your rule, so the corrections stay on the page.
3. Open `http://localhost:3000/api/captures/<host>`. Make sure that `rules` is `ok`, that each test case has the
   result `pass`, and that there are no `warnings`. If Suola refuses the rule, `rules` gives the error, and the
   server leaves out only this folder.

### 1.5 Try the faults

1. Restart the server with `make serve DEVSERVER_ARGS="--chaos=true"`. Some requests for the provider's documents
   then fail. Select **Update Database** some times, and make sure that the site recovers.
2. To see what Paatti does when it refuses a provider's Suola rules, restart with `--chaos.bad_rules=true`. This
   also breaks the Ilta-Pulu provider.

The same settings and the same folder give the same faults and the same documents. The server prints the command
of its settings at start. To report a problem, give that command and a copy of the folder. Do not commit the folder:
`test_data/` is not in git.

### 1.6 Copy the rules out

1. Copy the site from `sites.json` into Rahti's `sites.json`. Add the fields that step 2 tells, for example
   `enabled: false`.
2. If you wrote a Suola rule, copy it into `suola/rules.yaml`:

   ```bash
   yq -y '.sites' test_data/captures/<host>/rules.json
   ```

   If `rules.yaml` already has the domain, change that entry. Do not add a second entry for the same domain.
   Add a `signature` to each test case that has `expected`: the SHA-256 of the `expected` address
   (`printf %s '<expected>' | sha256sum`).
3. Send the Suola change to the [Suola repository](https://github.com/Klikkikuri/suola). A merge to its `main`
   branch publishes the compiled rules to Rahti, as
   [Publishing rules](../../suola/README.md#publishing-rules) tells. The rule changes the signs of the site's
   articles, so Rahti's data for the site must use the new signs.
4. Update the `suola` submodule and the `suola` wheel (and the packaged `base_rules.yaml` copy) in
   [packages/karikko/pyproject.toml](../../packages/karikko/pyproject.toml) together to the new Suola release, so
   that the extension's built-in rules and the development server get the rule too. Update the submodules
   together, because the same page must have the same rules on both sides.

---

## 2. Add the Site to Rahti's `sites.json`

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

## 3. Test the Site from a Local Rahti Checkout

Serve the Rahti checkout on the loopback address:

```bash
(cd ../rahti && python3 -m http.server 8000 --bind 127.0.0.1)
```

Add the checkout to an unpacked build as a provider:

1. On the settings page, under **🐛 Debug Settings** → **🔌 Providers**, turn on **Allow providers on this
   machine**.
2. Enter `http://127.0.0.1:8000/manifest.json`, select **Add**, then **Add provider**, and accept the browser
   prompts.
3. Turn on the new site in the site list, and accept the browser prompt for its origin. A site that a provider
   supplies is off until you turn it on.

The `development` environment lets a provider override sites, so the checkout also takes over the sites that
Rahti already has. Turn on again each of them that you test. Paatti downloads the checkout again at each database
update: select **Update Database** after you change `sites.json`. [Providers](../providers.md) tells the rules.

To see the origins that the new site adds to `manifest.json`, sync from the checkout:

```bash
make sites-sync SITES_MANIFEST=http://127.0.0.1:8000/manifest.json
```

The sync resolves the manifest with the same validation that a provider gets at runtime, and stops if it refuses a
site. It also stops if a `site-configs` href is not in the directory of the manifest, so that the pinned Rahti
commit pins the sites too. It writes `sites.lock.json` and the site origins in `manifest.json`:
`host_permissions` for an enabled site, `optional_host_permissions` for a disabled site or an origin that was
optional in the previous release, and the `web_accessible_resources` matches for all sites. The previous release
is the last `v*` tag before `HEAD`. Without git history or tags, as in a source archive, the committed
`manifest.json` takes its place. The sync does not change which sites the extension uses.

`make test` fails after a sync from a local copy. That is intentional: do not commit the result. A sync from a
local copy writes the local URL into `sites.lock.json` and records no Rahti commit, and CI stops on it too.

---

## 4. Publish, Then Sync from the Published Manifest

Commit and push `sites.json` in Rahti. Then sync Paatti from the published manifest, run the tests, and commit
`sites.lock.json` and `manifest.json`:

```bash
make sites-sync
make test
```

`make test` includes `make check-sites`, which fails if `manifest.json` does not agree with `sites.lock.json`. CI
compares the lock with the Rahti commit that it pins.
[Default Site Permissions](../release.md#default-site-permissions) tells which check runs where.
