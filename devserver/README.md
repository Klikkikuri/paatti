# Paatti development server

A development server for [Paatti](https://github.com/Klikkikuri/paatti). It serves:

- **Ilta-Pulu**, a fake news site in English. Its markup copies the structures of real news sites, so it exercises
  each path of Paatti's content script. All people, places and companies on it are invented.
- **Provider manifests** that Paatti can add as local providers.
- **Faults** in the provider documents and on the pages, switched on by settings.

The same settings and seed give the same page, byte for byte, and the same faults. A failure can thus be repeated
from the command line that the page shows.

How to add the provider to Paatti is in Paatti's README, section "Development Server".

## Run

The project uses [uv](https://docs.astral.sh/uv/). From Paatti's repository root:

```sh
make serve                                         # http://localhost:3000/
make serve DEVSERVER_ARGS="--seed=42 --chaos.provider_5xx=data"
```

Or in this directory:

```sh
uv run paatti-devserver --port=3000 --seed=42
```

At start, the server prints the seeds, the features that are off, the faults that are on and off, and the command
that starts a server with the same settings.

## Routes

| Route | Content |
| --- | --- |
| `/` | The front page. Without `?seed=`, it redirects to `/?seed=<--seed, or a random seed>`. |
| `/?seed=<n>&check=1` | The front page with the self-check panel. |
| `/<section>/a/<id>` | An article page. The section can have any letter case. |
| `/privacy` | The privacy notice that the manifests link. |
| `/manifest/ilta-pulu/manifest.json` | The Ilta-Pulu provider: `sites.json`, `rules.json` and `data.json` beside it. |
| `/manifest/captured-sites/manifest.json` | Rahti's real sites with fake corrections for captured links: `data.json` beside it. Needs `rahti_commit`. |
| `POST /api/capture` | Stores the links of a page that Rahti has no correction for (see "Captured sites"). Paatti's popup calls it. |
| `/api/fragment?seed=&kind=&n=` | HTML that `site.js` inserts: `more` (load more), `churn` (one card), `ticker` (one item). |
| `/docs` | The OpenAPI description of the routes. |

## Settings

The settings come from the command line and from environment variables with the prefix `PAATTI_DEVSERVER_`. No
other source is read (no `.env`, YAML or secrets file), so that the same command gives the same result. A nested
setting uses `.` on the command line and `__` in the environment: `--chaos.provider_5xx=data` is
`PAATTI_DEVSERVER_CHAOS__PROVIDER_5XX=data`. A set takes a comma-separated list.

| Setting | Default | Meaning |
| --- | --- | --- |
| `host` | `127.0.0.1` | The address to listen on. Use `localhost` if your browser tries `::1` first. |
| `port` | `3000` | The port. Suola matches a rule's domain with `host:port`, so the Ilta-Pulu rules carry the port. |
| `seed` | none | The page seed of `/`. Without it, `/` redirects to a random seed. |
| `pool_seed` | `1` | The seed of the article pool, and thus of `data.json`. A page seed changes only the layout. |
| `rahti_commit` | none | The Rahti commit of the captured-sites provider. `make serve` passes the commit in `sites.lock.json`. |
| `data_dir` | `test_data` | The directory for captured pages and the download cache. |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING` or `ERROR`. |

### Content features

Each content case is on by default. Turning one off removes only that case: the other articles stay the same.

| Setting | The case |
| --- | --- |
| `features.blocks` | The block types on the page (default: all; see "Block types"). |
| `features.levels` | One article at each of the five clickbait levels. Levels 0 and 1 stay below the default threshold. |
| `features.ai_slop`, `features.video`, `features.sponsored` | Articles with that label. AI and video show a badge. |
| `features.paywalled` | Paywalled articles with no corrected title: the PAYWALLED status. |
| `features.no_entry` | Articles that `data.json` does not contain: the SKIPPED status. |
| `features.missing_href` | A card whose link has no `href`. |
| `features.duplicate_link` | The same article twice, with the same address. |
| `features.edge_headlines` | Very long and very short headlines, emoji, markup as text, non-ASCII letters, soft hyphens, extra spaces. |
| `features.href_variants` | Links as relative, absolute, with a query, with a trailing slash, with a fragment, or with an upper-case section. Each variant gets the same signature. |
| `features.load_more` | A "Load more" button and infinite scroll. |
| `features.ticker` | A news ticker whose items are replaced every 5 seconds. |
| `features.xfail` | Expected failures (see "Expected failures"). |
| `features.annotations` | The expectations and the provenance in the markup (see "Annotations"). |

### Faults

Every fault is off by default. `--chaos` takes a profile, or a JSON object of the settings below:

| Profile | Faults |
| --- | --- |
| `none`, `false` | None (the default) |
| `true`, or `--chaos` alone | Each fault except `page_hostile_css`, provider faults on all documents, `chaos.rate` 0.03: about 3 in 4 document requests get no fault |
| `all` | Each fault, provider faults on all documents, `chaos.rate` 0.1: about 1 in 3 document requests get no fault |

A setting also given on its own overrides the profile, in any order: `--chaos=true --chaos.provider_timeout=` is the
`true` profile without timeouts. The environment takes the same values: `PAATTI_DEVSERVER_CHAOS=true`.

A provider fault names the documents that it applies to: `manifest`, `sites`, `rules`, `data`. It fires on a
request when `Random(f"{chaos.seed}:{flag}:{document}:{n}").random() < chaos.rate`. `n` counts the requests to that
document since the server started; Paatti fetches each document one time per refresh, and a retry counts as a
refresh. The same settings and the same order of requests thus give the same faults. Each fault that fires is
logged, and is named in the response header `X-Devserver-Chaos`.

| Setting | Effect | What Paatti shows |
| --- | --- | --- |
| `chaos.seed`, `chaos.rate` | The fault decision (default 0 and 1.0: a fault that is on always fires). | |
| `chaos.provider_timeout` | A delay of `chaos.provider_latency_ms` (default 12000). More than 10 s is a timeout. | A transient failure, retried |
| `chaos.provider_5xx` | 503 with `Retry-After` | A transient failure |
| `chaos.provider_429` | 429 with `Retry-After` | A transient failure |
| `chaos.provider_404` | 404 | A permanent failure: nothing from that document |
| `chaos.provider_redirect` | 302 | Paatti refuses redirects: a transient failure, the cached copy is used |
| `chaos.malformed_json` | The first half of the body | Errors |
| `chaos.oversize` | Valid JSON padded past the size limit (256 KB for the manifest, 8 MB for the others) | Errors, or the manifest is refused |
| `chaos.schema_mismatch` | `schema_version` 0.2.0 (manifest, sites) or 1.0.0 (data) | The provider or the document is not usable |
| `chaos.no_conditional` | Never 304 | The conditional request does not save the download |
| `chaos.rejected_sites` | Bad site entries: a port in the key, a foreign origin, `__proto__`, `*` | Rejected sites |
| `chaos.bad_rules` | A rule whose regex does not compile | Suola refuses the provider's rules; its links get no signature |
| `chaos.page_hostile_css` | A stylesheet that hides, resizes and resets elements | The badges keep their size. Known gap: `:not(:defined) { visibility: hidden }` hides them, because they force only `display`; an expected failure in `tests/e2e/test_dynamic.py` tracks it |
| `chaos.page_dom_churn` | `site.js` replaces a card every 4 seconds | New cards get their status; no replaced card keeps an old status |
| `chaos.page_late_content` | Some blocks are inserted 1.5 seconds after the page loads | The later conversion pass handles them |

A page fault is decided from the page seed, so a reload of one seed gives the same page.

## Captured sites

The captured-sites provider makes test data for a real Rahti site, for example www.iltalehti.fi, where Rahti has
no correction for a link. In a development build, Paatti's popup sends the page address and the links and
headlines of the page to `POST /api/capture`, with one click.

- The server accepts a page of any host, and signs each link with the base Suola rules, whose catch-all signs
  any host. At the pinned commit, they equal Rahti's rules, so the provider has no `suola-rules` and its signs are
  Paatti's official signs.
- The corrections take effect only on the sites that the provider supplies: Rahti's sites. A capture from another
  host, Ilta-Pulu included, is stored, but Paatti does not look it up.
- It fetches Rahti's current `data.json` and keeps only the links whose sign Rahti does not have. The other links
  keep their real correction: with "Allow providers to override sites" on, Paatti looks a link up in this provider
  first, so a fake entry would hide the real one.
- A capture of the same page again drops the links that Rahti has added since. If Rahti cannot be read, the
  capture fails with 502 and writes nothing.
- A fake corrected title starts with `[dev] `. Its level and labels come from the sign, so a link always gets the
  same ones.
- The captures are in `<data_dir>/captures/<host>.json`. Delete a file to forget the captures of that host.

The provider's `site-configs` resource is Rahti's `sites.json` at `rahti_commit`, so it declares the origins of
those sites. Adding the provider turns the Rahti sites off in Paatti until you turn them on, because a site that a
provider supplies starts off.

## Ilta-Pulu

### Block types

Each block type is one rule in `sites.json`. The rule names only a part of the markup, as on a real site: the
page seed adds noise around it (extra and hashed classes, `data-*` and `aria-*` attributes, wrapper elements,
kicker, time, comment-count and "LIVE" elements, images, comment nodes and spaces in the headline). The noise must
never stop a rule from matching.

| Block | Container / link / title | Path in the content script | Shape from |
| --- | --- | --- | --- |
| `lead` | `article.lead` / `:scope > a` / `h2 span:last-child` | The headline is the last span, after a kicker | hs.fi |
| `card` | `div.front div.card a` / `self` / `div.front-title` | The container is the link | iltalehti.fi |
| `story` | `div[class*='Story__Wrapper']` / `a[href*='/a/']` / `h3 a` | Hashed styled-components classes | yle.fi, bbc.com |
| `teaser` | `[data-testid='teaser-content']` / `a[data-testid='internal-link']` / `h2` | Test-id attributes | mtvuutiset.fi, bbc.com |
| `most_read` | `aside ol > li` / `a` / `h3 span:last-child` | A numbered list | hs.fi, theguardian.com |
| `ticker` | `div.newsticker > a.ticker-item` / `self` / `span.ticker-title` | Items that are replaced | iltalehti.fi |
| `briefs` | `aside[aria-labelledby=briefs] li:not(:last-child) a` / `self` / `self` | The link holds the text; `:not()` | yle.fi |
| `related` | `article.lead .related > a` / `:scope` / `h3` | A container inside another container | theguardian.com |
| `infographic` | `figure.infographic` / `a` / `svg text` | An SVG title, so badges become a text prefix | |
| `promo` | `.promo` / `a` / `.promo__title` | No title element: SKIPPED | |
| `sidebar` | `.sidebar .card` / `a` / `.card__title` | A longer corrected title in a two-line clamp | |

### Expected failures

These blocks look like a rule's target, but the rules must not convert them, because real sites have the same
near misses. The headline starts with `XFAIL:`. Where a wrong match could convert the block, the article that it
links to has the corrected title "XFAIL VIOLATED — this headline must not change", so a wrong conversion is visible
at once.

| `data-devserver-xfail` | The near miss | Passes when |
| --- | --- | --- |
| `outside` | The link is beside the container, not in it | The block has no status |
| `nested` | A link below the direct children of a `:scope >` container | The link has no status |
| `advert` | An advert with the teaser's classes but another `data-testid` | The block has no status |
| `external` | A link to another host | SKIPPED, or no status |
| `javascript` | A `javascript:` link, which cannot be signed | SKIPPED |
| `gap` | A ticker item whose text changes in place | Not checked: it shows a known gap. Paatti ignores a text change inside a headline that it has already processed. |

### Annotations

With `features.annotations` on, each block carries what Paatti must do with it and where it came from. The page
reads only the `data-klikkikuri-status` that Paatti already writes into it.

| Attribute | Content |
| --- | --- |
| `data-expect-status` | `converted`, `original`, `paywalled`, `skipped`, `xfail` or `gap`, under the default `development` settings |
| `data-expect-path` | The content-script path that the block exercises |
| `data-expect-entry` | The data entry: level, corrected title, labels; or `none` |
| `data-devserver-block` | The block type and the index of its rule in `sites.json` |
| `data-devserver-noise` | The noise kinds on the block |
| `data-devserver-href` | The link variant |
| `data-devserver-xfail` | The kind of expected failure |
| `data-devserver-chaos` | The page fault that touched the block |
| `data-devserver-source` | `front`, `article`, `more:<n>`, `churn:<n>` or `ticker:<n>` |

No site rule names these attributes; a test checks this. `?check=1` shows a panel that lists each block whose
status does not meet its expectation, with its provenance. The panel is in a shadow root under `<html>`, outside
`<body>`, because Paatti observes `<body>` and would otherwise process the page again at each redraw.

## Tests

```sh
make test-devserver    # from Paatti's root: pytest, then the drift guard against a live server
make test-e2e          # from Paatti's root: Paatti in Chromium against Ilta-Pulu
uv run pytest          # in this directory: the server's own tests only
```

- The pytest suite uses [Hypothesis](https://hypothesis.works/) for seeds and feature sets. A failure shrinks to
  the smallest seed and settings that fail. `HYPOTHESIS_PROFILE=ci` repeats the same examples on each run;
  the default `dev` profile searches at random and keeps failures in `.hypothesis/`.
- The rule-match tests use a Python copy of the content script's scan, with the html5lib parser, which builds the
  same tree as a browser. The drift guard and the end-to-end tests are the final check of the selectors.
- `tests/e2e/` takes `--extension-dir` (an unpacked build), `--chromium` (default
  `/usr/lib/chromium/chromium`) and `--e2e-seeds`. A headless browser cannot answer a permission prompt, so it loads
  a copy of the extension whose `manifest.json` also requires `http://localhost/*`. All other setup calls the
  extension's own modules.

## Workarounds for upstream issues

| Issue | Workaround |
| --- | --- |
| [Niitti#3](https://github.com/Klikkikuri/Niitti/issues/3), [#4](https://github.com/Klikkikuri/Niitti/issues/4): extras do not declare their imports | `niitti[all]` and `pyyaml` |
| [Niitti#5](https://github.com/Klikkikuri/Niitti/issues/5): settings read implicit files | `settings.py` keeps only the command line and the environment |

## Layout survey

The block types copy patterns found on these front pages in October 2026. Only the structure was recorded, never
the text. iltalehti.fi and hs.fi render most links in the browser; the pinned Rahti `sites.json` shows their
rules.

| Pattern | Sites |
| --- | --- |
| The link inside a heading, the text directly in the link (`h3 > a`) | yle.fi, ampparit.com, foxnews.com, aksa.fi |
| styled-components classes with a hash (`IndexCard-styles__Card-sc-3a0d8802-0 jeApUG`), and `dcr-<hash>` classes | bbc.com, yle.fi, theguardian.com |
| `data-testid` on cards and links | bbc.com, mtvuutiset.fi, hs.fi, is.fi |
| The headline in a span beside other spans (`a > span.pufftext > strong`, `h3 > span.headline-text`) | dailymail.co.uk, theguardian.com, hs.fi |
| An image inside the link | dailymail.co.uk, bbc.com, hs.fi |
| A description inside the link, longer than the headline | bbc.com |
| Utility classes with `:` and `/` (`group-hover:underline`, `lg:w-6/12`) | mtvuutiset.fi, aksa.fi, hs.fi |
| A `time` element beside the link; carousel items | iltalehti.fi, yle.fi |
| Lists of links inside a card | theguardian.com |
| The headline after a kicker span, matched as the last span | hs.fi (Rahti rules) |
