- shellcheck on container

- Make the site list live. `site-list-setting.js` used to carry a filter on a `config` storage key that nothing
  ever writes, so it never re-rendered; the filter is gone rather than fixed. The list itself is static, but the
  per-site enabled state belongs to `site-toggle.js`, which has no subscription of its own — that is where a live
  list has to come from.

- `power-button` re-syncs on config change only, so a permission revoked with no accompanying storage write goes
  unnoticed. In practice grants and revocations go through `site-toggle`, which writes `userSiteOverrides`, so it
  stays covered; the real fix is `browser.permissions.onRemoved`.

- When `minimum_chrome_version` reaches 148, retire the namespace shim: delete `src/browser-api.js` and the 25
  imports of it, drop the inline bind at `src/contentScript.js:17`, remove the `src/browser-api.js` entry from
  `web_accessible_resources` in `manifest.json`, delete `tests/browser-namespace.test.mjs`, cut the `browser`
  entries from both lint rules in `eslint.config.mjs` along with the two file exemptions, and prune the shim
  paragraphs from `AGENTS.md`. Chrome 148 reached stable on 05.05.2026. Raise the floor on a staged Web Store
  rollout: installs below it stop receiving updates, and the user is never told.
