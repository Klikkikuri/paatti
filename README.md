# ⛵ Klikkikuri Paatti

Sail smoothly through the clickbait-infested web using this browser extension.

- [⛵ Klikkikuri Paatti](#-klikkikuri-paatti)
  - [Features](#features)
  - [Supported Sites](#supported-sites)
    - [Works After You Install](#works-after-you-install)
    - [Needs Your Permission First](#needs-your-permission-first)
  - [Screenshots](#screenshots)
    - [Replaced Headlines on a News Site](#replaced-headlines-on-a-news-site)
    - [Normal Operation](#normal-operation)
    - [Feedback Without Leaving the Page](#feedback-without-leaving-the-page)
    - [The Popup](#the-popup)
    - [Dark Mode](#dark-mode)
    - [Settings](#settings)
  - [Install](#install)
    - [From a Browser Store](#from-a-browser-store)
    - [From a GitHub Release](#from-a-github-release)
  - [Permission Requirements](#permission-requirements)
  - [How It Works](#how-it-works)
  - [Privacy Policy](#privacy-policy)
  - [License](#license)
    - [Non-OSS Assets](#non-oss-assets)
  - [Development](#development)
    - [Build from Source](#build-from-source)
      - [Requirements](#requirements)
      - [Build Flags and Options](#build-flags-and-options)
    - [Load a Development Build](#load-a-development-build)
    - [Run the Tests](#run-the-tests)
    - [Lint](#lint)
    - [Environments](#environments)
    - [Developer and Diagnostic Utilities](#developer-and-diagnostic-utilities)
    - [Badge Icons](#badge-icons)
    - [Development Server](#development-server)
    - [Architecture](#architecture)
    - [Make a Release](#make-a-release)

## Features

- Paatti **replaces sensational, misleading and clickbaity headlines** with neutral, factual alternatives on
  supported sites.
- The extension **looks up headlines in a database on your own device**. It downloads that database from
  GitHub at intervals. It **does not send your browsing history** to an external server, unless you take an
  explicit action such as sending feedback. See the [Privacy Policy](docs/PRIVACY_POLICY.md).
- The Go-compiled WebAssembly module [`suola`](https://github.com/Klikkikuri/suola) **normalizes and hashes
  (SHA-256) each URL locally**, so a lookup needs no network request.
- A debounced DOM `MutationObserver` watches the page. **Paatti replaces new headlines as you browse** or as
  the site loads more content.
- Paatti fully supports **Firefox for Android**, **Firefox**, **Chrome**, **Chromium**, and **Brave**.
- The user interface is fully **translated** and available in **English and Finnish**.
- The popup and the settings page **follow your browser's light or dark theme** by themselves. The markers
  Paatti puts on a news page instead take the colours of the site around them, so they stay legible on a dark
  site and on a light one.
- Adjustable **clickbait threshold** to set how clickbaity a headline must be before Paatti replaces it.
- The popup shows:
  - A **clickbait density gauge** for the page you are on.
  - Headline counts grouped by severity, from "Not Clickbait at all" to "Extremely Clickbaity".
  - A **feedback list** of the headlines Paatti changed. You can rate a replacement, send a suggestion, and
    open an **expando section** that shows the headlines below your threshold.
  - The **database status**: when Paatti last downloaded corrections, and a button to download them now. You
    can also set how often it checks.
  - A **shortcut that searches the GitHub issues** for the site you are on, so you can see whether support for
    it was already requested. To request a new site, open an issue.
- The settings page gives you:
  - A **switch for each supported site**.
  - A **threshold slider** that sets how clickbaity a headline must be before Paatti replaces it.
  - Three **headline markers**. Only the AI Content Marker is on when you install Paatti; switch the other two
    on if you want them, or switch all three off to let Paatti work with no visible mark at all:
    - The **AI Content Marker** tells you that the article shows characteristics typical of AI-generated or
      AI-translated material. Use it to decide whether an article is worth your time, if the author did not bother writing it themselves.
    - The **Video Content Marker** tells you that a link leads mostly to video rather than to a written article.
    - The **Converted Headline Marker** tells you that Paatti replaced this headline. It is a button: click it,
      or move to it with the keyboard and press Enter, to open the feedback card for that headline.

## Supported Sites

Sites fall into two groups. The group decides whether Paatti starts by itself, or waits for you.

### Works After You Install

Paatti starts on these sites immediately. It needs no further action from you.

- *Helsingin Sanomat* (`hs.fi`)
- *Iltalehti* (`iltalehti.fi`)
- *Yle* (`yle.fi`)
- *MTV Uutiset* (`mtvuutiset.fi`)
- *Äänekosken Kaupunkisanomat* (`aksa.fi`)

### Needs Your Permission First

- *Ampparit Uutispalvelut* (`ampparit.com`)

This site is off by default. When you switch it on in the settings, the browser asks you to approve access to
it. Paatti starts on the site only after you approve. If you decline, the site stays off. If you switch it on
from the popup, the popup closes, because the browser cannot show the approval prompt inside a popup.

To ask for support for another site, open an issue on GitHub.

## Screenshots

### Replaced Headlines on a News Site

The same Yle "Suosituimmat" list at two threshold settings, with the visual debug mode on. The coloured outline
and the badge on each card are developer tools that are off by default — they are here to make the threshold
visible. Green **CONVERTED** means Paatti replaced the headline, orange **ORIGINAL** means it left it alone.

At **Moderately clickbaity**, the top three stories are replaced. The first reads "Laatokan järvilohet ovat
nousseet kutemaan Hiitolanjokeen ensimmäistä kertaa 115 vuoteen".

![Yle popular-stories list at a moderate threshold, the top three cards outlined green and badged CONVERTED](./docs/screenshots/v0010-levels-moderate.png)

At **Only extreme**, nothing in the list clears the bar, so every card keeps the site's own wording. The same
first story now reads "Venäjältä nousi koskeen kaloja, joita ei ole nähty 115 vuoteen – nyt vesistöpäällikkö
odottaa jättipottia", which withholds the fact the replacement states.

![The same list at the highest threshold, every card outlined orange and badged ORIGINAL](./docs/screenshots/v0010-levels-extreme.png)

### Normal Operation

The same page as a user sees it, with the debug mode off. No outlines and no status badges: the page reads as
Yle's own. The only sign of Paatti is the small marker before each headline it changed, and the AI Content
Marker on the Google story further down.

All three markers are switched on here. A new install shows only the AI Content Marker — the Video Content
Marker and the Converted Headline Marker start off. Each has its own switch, so you can also turn all three off
and let Paatti replace headlines leaving no visible mark.

![Yle news page with replaced headlines, no debug outlines, small markers before changed headlines](./docs/screenshots/v0010-in-action.png)

### Feedback Without Leaving the Page

Clicking the Converted Headline Marker opens this card beside the headline, so you can rate a replacement while
you read. It names the site's **ORIGINAL** headline and its severity, shows the **ALIGNED** replacement under
it, and outlines the headline the card belongs to.

This card is the marker's own function, so it needs the Converted Headline Marker switched on — which a new
install does not do. Without the marker there is nothing to click, and the popup's feedback view is the way to
rate a replacement; it lists every one on the page.

![In-page feedback card next to a headline, showing the original and aligned versions and two rating buttons](./docs/screenshots/v0010-feedback-card.png)

### The Popup

The home view rates the page you are on. The gauge gives one number for the whole page, and the rows below
count the headlines at each severity. The dotted line labelled **Threshold** sits where your setting is: rows
above it are left alone, rows below it are replaced. You can drag that line to change the setting.

![Popup home view with a 41% gauge reading Moderately Clickbaity above a list of severity counts](./docs/screenshots/v0010-popup-home.png)

The feedback view lists what Paatti changed on this page. Each entry shows the site's **ORIGINAL** headline with
its severity, the **ALIGNED** replacement underneath, and two buttons to say whether the replacement is fair, or send feedback if it should be improved.

![Popup feedback view showing original and aligned headline pairs with Is good and Is no good buttons](./docs/screenshots/v0010-popup-feedback.png)

The statistics view totals what Paatti has seen on this site since it started counting.

![Popup statistics view reading 31 of 75 converted titles, with a bar per severity level](./docs/screenshots/v0010-popup-stats.png)

### Dark Mode

Paatti's own pages follow `prefers-color-scheme`, so they turn dark when your browser or system does. There is
no theme setting to keep in step, and the background artwork has a night version of its own.

![Popup home view in dark mode, the gauge over a dark night-sky background](./docs/screenshots/v0010-popup-home-dark.png)

The markers Paatti adds to a news page work the other way round, and deliberately so. They paint with the
page's own text colour and knock the glyph out of it, so they read correctly against whatever the site uses. A
marker that followed the system theme instead would come out black on a dark site whenever the system was set
to light. [`src/components/badge-style.js`](./src/components/badge-style.js) carries the reasoning.

### Settings

Each supported site has its own switch, showing the site's own icon. Ampparit is off, because it is the site
that needs your permission first. Below the list sits a switch for each of the three headline markers; all
three are on in this picture, but a new install starts with only the AI Content Marker.

![Settings page site list with per-site switches, Ampparit switched off, above the three marker settings](./docs/screenshots/v0010-options-sites.png)

The statistics section totals every enabled site, and names the one that was most clickbaity. A button under
the table resets the tally; press it twice within a few seconds to confirm.

![Settings page statistics with totals, a severity breakdown bar, and a per-site table](./docs/screenshots/v0010-options-markers.png)

## Install

### From a Browser Store

Install Klikkikuri Paatti from the [🛍️ Google Chrome Web
Store](https://chromewebstore.google.com/detail/klikkikuri-paatti/jalegaigmgljhnaakmbbaajooffgcbgc?hl=en) or
from [🦊 Mozilla Firefox Add-ons](https://addons.mozilla.org/fi-FI/firefox/addon/klikkikuri/). Use a store
version unless you want to develop the extension or to test a newer build.

Paatti needs Firefox 128 or later, or Chrome 122 or later. Firefox for Android is supported.

### From a GitHub Release

The release carries a signed `.xpi` for Firefox and a `-chrome.zip` for Chrome.

To install the packaged extension in Firefox:

1. **Download the release.** Go to the [Klikkikuri Paatti
   releases](https://github.com/Klikkikuri/paatti/releases) page and download the newest `klikkikuri-paatti`
   `.xpi` file.
2. **Open the Firefox add-ons page.** Enter `about:addons` in the address bar, or open the menu and select
   **Add-ons and Themes**.
3. **Install from the file.**
   - Click the gear icon (⚙️) next to "Manage Your Add-ons".
   - Select **Install Add-on From File...**.
   - Select the `.xpi` file you downloaded.
   - Confirm the installation.

Chrome does not permit an extension to install from a file in the same way. Extract the `-chrome.zip` and load
the directory through `chrome://extensions` → **Developer mode** → **Load unpacked**.

## Permission Requirements

- `host_permissions`: Paatti reads the headlines on the supported news sites and replaces their text, so it
  needs access to those pages. This permission also covers
  `raw.githubusercontent.com/Klikkikuri/rahti/*`, which is where Paatti downloads the correction database,
  the site settings and the URL normalization rules (Suola rules) from.
- `optional_host_permissions`: Paatti asks for these only when you need them. `www.ampparit.com` is requested
  when you switch that site on. The GitHub build also declares `*://*/*`, so that you can add a
  [provider](docs/providers.md) under Debug Settings. A provider is a set of correction files that another
  person or organization publishes on their own `https` server. Paatti asks for the provider's host when you add
  it, for the hosts of its files when you confirm, and for the host of one of its sites when you turn that site
  on. The store build does not declare the wildcard, so it cannot add a provider.
- `alarms`: Paatti schedules the database download in the background. The alarm lets the background service
  worker sleep between downloads, which saves system resources.
- `storage`: Paatti keeps the downloaded correction database, your settings, your statistics and the site icon
  cache on your device. Your settings follow your browser profile if you use browser sync.
- `tabs`: Paatti must know when you open a supported news site, and when a site replaces its content without a
  page load. It uses this to decide when to examine the page.
- `favicon`: Chromium keeps the icons of the sites you visit, and this permission lets Paatti read one from
  that cache with no network request. Where the cache has no icon, Paatti shows an icon it stored earlier, and
  if it has none, a generated letter badge. To fill that store, Paatti reads the icon address from a supported
  page and downloads the icon once per site, without cookies and without a referrer, then keeps it for 30 days.
- `scripting`: Paatti registers and unregisters its content script per site, which is how a site switch takes
  effect without a browser restart. It also lets Paatti hold no permission at all for an optional site until
  you switch that site on.

## How It Works

Klikkikuri Paatti is the browser extension. Three other projects stand behind it:

- [meri](https://github.com/Klikkikuri/meri) reads the articles, judges whether a headline matches the article,
  and writes a neutral replacement.
- [suola](https://github.com/Klikkikuri/suola) normalizes and hashes URLs. The backend and the extension use
  the same module, so both sides agree on the signature for an article.
- [rahti](https://github.com/Klikkikuri/rahti) publishes the result as
  [`data.json`](https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json). Its
  [manifest](https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/manifest.json) lists that file
  with the site settings and the Suola rules.

Paatti downloads the files of that manifest, keeps them on your device, and looks each headline up in them. Your
browsing does not leave your machine to make a lookup.

Which headlines the database covers is decided by the backend, not by the extension. Sports headlines, for
example, are not corrected, although they are often written in a sensational style.

For more about the projects, see the [Klikkikuri organization profile](https://github.com/Klikkikuri).

## Privacy Policy

For information about data handling and user privacy, please refer to our [Privacy
Policy](docs/PRIVACY_POLICY.md).

## License

This project is licensed under the European Union Public Licence v1.2 (EUPL-1.2).

- English version: [LICENSE.md](LICENSE.md)
- Finnish version (Suomenkielinen versio): [LISENSSI.md](LISENSSI.md)

### Non-OSS Assets

The assets in [`assets/non-oss/`](./assets/non-oss/) are not covered by the EUPL-1.2 license.

- The AI Content Marker icon in [`assets/non-oss/by-kagi/`](./assets/non-oss/by-kagi/) is designed by and
  copyright of [Kagi Inc.](https://kagi.com/) and used with permission (see
  [`assets/non-oss/by-kagi/PERMISSION.txt`](./assets/non-oss/by-kagi/PERMISSION.txt)).

`make build` leaves these assets out. The build must opt in with `NON_OSS=1`, which the release workflow does —
so the packages published to the stores and to GitHub Releases do contain the Kagi icon. A build without
`NON_OSS=1` draws the marker with the EU-styled vector badge in [`assets/icons/`](./assets/icons/) instead.

---

## Development

Read **[AGENTS.md](AGENTS.md)** before you change anything under `src/`. It holds the binding conventions of
this repository: how to reach the extension API, the three populations of web components and why they differ,
where a stylesheet belongs, and the traps around settings, extractor registration and prompts.

### Build from Source

```sh
make build
```

`make build` first checks that the `suola` submodule is present. It then compiles `suola` to WebAssembly
(`js.wasm` and its support file `wasm_exec.js`) with Docker, or with a host toolchain when `DOCKER=false`. The
two files must come from the same toolchain to work together, so run `make clean` when you change build method.
Finally it stages the extension assets (`src/`, `icons/`, `_locales/`, `manifest.json`, `LICENSE.md`,
`LISENSSI.md`, `docs/PRIVACY_POLICY.md` and `docs/PRIVACY_POLICY_DEVELOPMENT.md`) with the WebAssembly
binaries into `build/dist/`, writes one tree per browser into `build/dist-chrome/` and `build/dist-firefox/`,
and packages them into `build/klikkikuri-paatti-chrome.zip` and `build/klikkikuri-paatti-firefox.zip`.

If the `suola` submodule is missing, `make` fetches it with `make init`. You can also clone the repository
with `git clone --recursive` to get it from the start.

#### Requirements

- `make`, `bash`, `git`, `zip` and `curl`
- Node.js. Every build runs `check-icons`, `make test` needs it, and the e2e in `tests/e2e` runs it with
  `playwright-core`.
- `eslint` and `web-ext` for the lint targets. Both come from the dev container image.
- (optional) Docker (tested on version 28.1.1) or `podman` (tested on version 5.4.2). Docker builds the test
  image that the e2e and drift CI jobs run in.
- (optional, for the development server) [`uv`](https://docs.astral.sh/uv/), which installs the Python that it
  needs. The server is the `packages/karikko` submodule; `make serve` runs it.
- The [`suola`](https://github.com/Klikkikuri/suola) submodule
  - TinyGo 0.41+, to compile it locally without Docker

#### Build Flags and Options

Pass `DOCKER=false` to **compile suola on the host** instead of in a container:

```sh
make build DOCKER=false
```

Pass `DOCKER=podman` to **build with podman**:

```sh
make build DOCKER=podman
```

Pass `USE_RELEASE_ARTIFACTS=1` to **download the WebAssembly binaries** from the `suola` release of the tag that
the submodule pins, instead of compiling them. The CI build and every store build use this path, and the tag must
have a release with both files:

```sh
make build USE_RELEASE_ARTIFACTS=1
```

Pass `NON_OSS=1` to **include the non-OSS assets**, which overlays `assets/non-oss/by-kagi/` onto `src/`:

```sh
make build NON_OSS=1
```

Other targets: `make package` zips the per-browser trees, `make dist-chrome` and `make dist-firefox` stage one
browser's tree, `make store-build` overwrites the two zips with the store packages (always with `NON_OSS=1` and
`USE_RELEASE_ARTIFACTS=1`) and adds the source archive for a manual store upload,
`make source-dist` packages the source for review, `make rebuild-suola` forces a WebAssembly rebuild,
`make test-wasm` runs suola's own smoke test, and `make sites-sync` writes the origins of the default sites into
`manifest.json`. See [Default Site Permissions](docs/release.md#default-site-permissions).

`manifest.json` is the base for both browsers; `manifest.chrome.json` and `manifest.firefox.json` remove what the
other browser does not accept. See [Browser Manifests](docs/release.md#browser-manifests) for the merge rules.

`make init` fetches the `suola` submodule.

### Load a Development Build

Use [`run.sh`](./run.sh). It builds the extension and starts a browser with a clean profile:

```sh
./run.sh                        # Firefox
./run.sh --ff                   # Firefox Developer Edition
./run.sh --cr                   # Chromium
./run.sh --dark                 # Force the dark theme
./run.sh -u https://yle.fi/     # Open this page on startup
./run.sh -s .                   # Run a directory as-is, instead of build/dist
```

`run.sh` reads [`web-ext-config.cjs`](./web-ext-config.cjs) from the repository root, which carries the browser
preferences and the watch-ignore patterns.

The repository root is itself a loadable unpacked extension, so you can also load
[`manifest.json`](./manifest.json) by hand: in Firefox through `about:debugging` → **This Firefox** → **Load
Temporary Add-on...**, and in Chrome through `chrome://extensions` → **Developer mode** → **Load unpacked**.
See the [Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) and
[Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) documentation
for the current steps.

### Run the Tests

```sh
make test
```

The suites live in `tests/` and run on the built-in [`node:test`](https://nodejs.org/api/test.html) runner. A new
`tests/*.test.mjs` file is picked up automatically — nothing to register. Shared fixtures go under
`tests/helpers/`, which the runner does not treat as suites. `make test` also runs `suola`'s Wasm smoke test when
`build/` holds the artifacts, and skips it with a note when it does not. It also runs `make check-sites`, which
compares the origins in `manifest.json` with `sites.lock.json` and does not connect to the network.

`make test-devserver` runs the development server's own tests, and then checks a running server with Paatti's own
provider resolver, Suola module and content-script scan ([`tools/devserver-drift.mjs`](./tools/devserver-drift.mjs)).
`make test-e2e` loads the unpacked build into Chromium and checks that each block on Ilta-Pulu gets its expected
status. Both need `uv`; see [Development Server](#development-server).

Tests that touch the extension APIs use the in-memory fake in
[`tests/helpers/fake-browser.mjs`](./tests/helpers/fake-browser.mjs), which really dispatches
`storage.onChanged`. Assign it to `globalThis.browser` **before** a dynamic `await import(...)` of the module
under test — `src/browser-api.js` resolves the namespace once, at module evaluation, so a static import would
beat the assignment.

Tests that need a DOM use [`tests/helpers/dom.mjs`](./tests/helpers/dom.mjs), which puts a jsdom document on
`globalThis`. Install it before the dynamic import as well: a component module builds its templates and calls
`customElements.define` at evaluation time. jsdom comes from the dev container image rather than a
`package.json`, so `make test` needs the container — the `test` target points `NODE_PATH` at the global npm root,
because ESM resolution ignores it and the helper reaches jsdom through the CJS resolver.

jsdom does no layout and does not resolve the cascade, so it covers structure, lifecycle and events but says
nothing about styling. Check CSS in a real browser instead.

### Lint

```sh
make lint          # eslint; this is what CI runs
make lint-webext   # web-ext lint; run this by hand
```

`make lint` rejects a bare `browser` or `chrome` global and `globalThis.browser`. See
[AGENTS.md](AGENTS.md) for the two exempt files and the reason for the rule.

`make lint-webext` is deliberately not part of `make lint`, and CI does not run it. It lints the Firefox tree
with `--self-hosted`, which permits the gecko `update_url` that self-hosted Firefox updates need, and fails on any
error. Three warnings remain: the Chrome-only `favicon` permission, and `data_collection_permissions`, which
Firefox 128 does not know yet, on desktop and on Android. Keep the `UNSAFE_VAR_ASSIGNMENT` count at zero — that
count is the one signal that separates a static template from markup a caller can influence.

### Environments

Paatti carries three environments, defined in `DEFAULT_CONFIG.environmentConfigs` in
[`src/config.js`](./src/config.js). They differ in how often the database refreshes, which markers start on, and
whether a provider can override a site. All three use the Rahti provider manifest as their default provider. See
[docs/providers.md](./docs/providers.md).

| Environment | Purpose |
|---|---|
| `free` | The released default. |
| `paid` | Reserved for a paid service with additional lists. Not yet available. |
| `development` | Refreshes every minute, turns the debug visuals and the video and converted markers on, and lets a provider override a site. |

**An unpacked build selects `development` by itself**, because `management.getSelf().installType` reports
`development` for it. The defaults you see in a build you loaded yourself are therefore not the defaults a user
gets from a store. Keep this in mind when you check behaviour or take screenshots.

### Developer and Diagnostic Utilities

Turn developer mode on by clicking the logo at the foot of the popup, beside "Made with". A 🤓 appears next to
it while developer mode is on, and the hidden controls become visible. Turning it on switches the environment to
`development`; turning it off switches back to `free`.

- Paatti writes **`data-klikkikuri-*` attributes** on the elements it examined: `status`, `url-sign`,
  `clickbait-level`, `original-title`, `converted-title`, `labels` and `highlight-id`. Read them in the
  inspector to see what Paatti decided and why.
- **Visual debug mode** draws an outline and a status badge over each examined headline. The badge names the
  status Paatti gave it: converted, original, 🔒 paywalled, skipped or error. Two settings control the overlay:
  `debugVisualsEnabled` comes from the environment, and `visualHighlightEnabled` is your own override. Note
  that an open popup forces the outlines on, whatever the setting says.
- **Send page** in the popup's **Developer Settings** sends the links and headlines of the page to the
  [development server](#development-server), which makes a test correction for each of them. The row
  shows only when a provider on your own machine names a capture address.

### Badge Icons

The icons the in-page badges draw are authored as standalone SVG files under [`assets/icons/`](./assets/icons/) —
Kagi's beside its permission file in [`assets/non-oss/by-kagi/`](./assets/non-oss/by-kagi/). Edit one in a vector
editor, then write it into the module that draws it:

```sh
make icons
```

Each badge module names its source and fences the region the generator owns:

```js
// @icon-source assets/icons/video-badge.svg
// BEGIN GENERATED ICON -- edit the .svg, then run `make icons`
const svgMarkup = `…`;
// END GENERATED ICON
```

The generated block is committed on purpose. The project root is itself a loadable unpacked extension (see
[Load a Development Build](#load-a-development-build)) and there is no bundler, so a module cannot resolve its
icon at load time and `src/` must never hold a placeholder. `make dist` runs `make check-icons` first and fails
when a module has drifted from its SVG, naming the file to regenerate.

[`tools/inline-icons.mjs`](./tools/inline-icons.mjs) rejects a source the badge machinery cannot draw, while it
is still a fixable file rather than a blank box on a news site: the `<svg>` root must carry
`xmlns="http://www.w3.org/2000/svg"` (the markup is parsed as XML, which has no implicit namespace),
`class="badge-icon"` (which sizes the badge against the headline) and a `viewBox`; and no comment may contain
`--`, which XML does not allow. Colours belong to the page, not the icon — paint with `currentColor` and knock
the glyph out with a `<mask>`, as [`src/components/badge-style.js`](./src/components/badge-style.js) explains.

A new badge needs its SVG, a module carrying the two markers above, and a `make icons` run.

### Development Server

[`packages/karikko`](./packages/karikko/), a git submodule of [Klikkikuri/karikko](https://github.com/Klikkikuri/karikko),
is the development server for Paatti. It serves **Ilta-Pulu**, a fake news site in
English, and a provider manifest that supplies Ilta-Pulu's site rules, Suola rules and corrections. Ilta-Pulu
exercises each path of the content script: link and title selectors of the shapes that real news sites use, every
clickbait level, the badges, paywalled and skipped links, expected failures, and content that loads later. A seed
decides the layout, so the same seed gives the same page. The server can also inject faults into the provider
documents. [karikko/README.md](./packages/karikko/README.md) lists all of its settings.

1. **Start the server.** It needs [`uv`](https://docs.astral.sh/uv/), which the dev container has:

   ```sh
   make serve                                    # http://localhost:3000/
   make serve DEVSERVER_ARGS="--seed=42"         # a fixed page seed
   ```

   `./run.sh` does steps 2 and 3 for you when the server answers, in a staged copy of the build under
   `build/run-devserver` (`tools/devserver-stage.mjs`). The copy keeps the source tree untouched: it swaps the
   background to `tools/devserver-bootstrap.js`, which on the first install turns on loopback providers, adds the
   Ilta-Pulu and captured-sites providers from `devserver.json`, refreshes them, and turns on their site — the
   steps below, done by code instead of by hand. `--devserver` and `--no-devserver` override the check; with
   `-s DIR --devserver` the staging still happens, so the directory runs as-is only without `--devserver`.

2. **Add the provider.** Make sure that the environment is `development`: an unpacked build starts in it. On the
   settings page, under **🐛 Debug Settings** → **🔌 Providers**, turn on **Allow providers on this machine**.
   Enter `http://localhost:3000/manifest/ilta-pulu/manifest.json`, select **Add**, then **Add provider**, and
   accept the browser prompts.
3. **Turn on the site.** A site that a provider supplies is off until you turn it on. Turn on **Ilta-Pulu** in the
   site list, and open `http://localhost:3000/`.

Each page shows its seed and the command that gives the same page again. Add `&check=1` to the address to show
the self-check panel: it compares the status that Paatti gave each block with the status that the page expects.
The expectations apply to the default settings of the `development` environment.

Use `localhost`, not `127.0.0.1`: the site's origin is `http://localhost/*`. Ilta-Pulu has these side effects in
the extension:

- Paatti refuses to download a favicon from a loopback address, but each attempt uses one of the favicon requests
  that all sites share.
- The statistics get an entry for `localhost`.
- In the `development` environment, feedback goes to the production feedback form. Do not send feedback from
  Ilta-Pulu.

The server listens on `127.0.0.1` only.

**Test data for any page.** The server also makes test corrections for the links of any page, for example
www.iltalehti.fi or example.org:

1. Start the server with `make serve`.
2. Add `http://localhost:3000/manifest/captured-sites/manifest.json` as a provider, as in step 2 above.
   `./run.sh` adds it for you.
3. Open the page, open the popup, and select **Send page** under **Developer Settings**. On a site that Paatti
   does not support, or that is off, the browser asks for the permission of the site first. If the popup closes,
   open it and select **Send page** again.

The provider then supplies the site, and the popup turns the site on. Each link that you send gets a test
correction, which starts with `[dev]`. It replaces a real correction of the same link, because the development
environment lets a provider take over a site. The server keeps each site in a folder in `test_data/captures/`, where
you can edit its selectors and its Suola rules; delete the folder to forget that site.
[Adding a new site](./docs/development/adding-a-new-site.md) gives the workflow, and
[the karikko README](./packages/karikko/README.md#captured-sites) tells more.

### Architecture

See [docs/architecture.md](./docs/architecture.md) for the module diagram and the paths between the modules.

### Make a Release

`make release VERSION=x.y.z` bumps `manifest.json`, appends the release to `updates.json`, commits and tags.
`git push origin HEAD --follow-tags` then lets CI build, sign and publish the GitHub Release. Write the changelog
into that Release. The stores are published afterwards by hand, from the **Publish to AMO** and **Publish to
Chrome Web Store** workflows on the Actions tab; AMO shows the Release body as its release notes. Read
[docs/release.md](./docs/release.md) before your first release: it lists the checks to do before you start.
