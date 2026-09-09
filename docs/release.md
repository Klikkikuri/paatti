# Release and Publish

This document tells you how to make a release of Klikkikuri Paatti and how to publish it to the browser stores.

## Overview

Paatti has two distribution channels. A release goes to the first channel. Publishing sends the same release
to the second channel.

| Channel | Command | Version | Update source | Record in the repository |
|---|---|---|---|---|
| GitHub Release | `make release`, then a `v*` tag | `X.Y.Z` or `X.Y.Z.W` | `updates.json` (Firefox) | `manifest.json`, `updates.json` |
| Stores (AMO, Chrome Web Store) | The "Publish to AMO" and "Publish to Chrome Web Store" workflows | `X.Y.Z.N` | The store | None |

The GitHub Release carries a signed Firefox `.xpi` for self-hosted installs and a Chrome `.zip`. The stores
carry their own copies with a store version. Publishing does not change `updates.json`.

## Before You Start

1. Make sure that `main` is clean and up to date.
2. Make sure that the `suola` submodule is at a tag. The release build downloads the `suola` artifacts of
   that tag.
3. Make sure that the repository has these secrets under **Settings → Secrets and variables → Actions**. A
   repository admin creates them.

   | Secret | Environment variable the tool reads | Use |
   |---|---|---|
   | `AMO_JWT_ISSUER` | `WEB_EXT_API_KEY` | AMO API credentials, for unlisted signing and for the AMO listing |
   | `AMO_JWT_SECRET` | `WEB_EXT_API_SECRET` | |
   | `CWS_CLIENT_ID` | `CLIENT_ID` | Chrome Web Store API credentials. Get them with the [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys) guide. |
   | `CWS_CLIENT_SECRET` | `CLIENT_SECRET` | |
   | `CWS_REFRESH_TOKEN` | `REFRESH_TOKEN` | |
   | `CWS_PUBLISHER_ID` | `PUBLISHER_ID` | |

   The secret names carry a prefix so that they are not ambiguous in the repository. The publish workflows
   map each secret to the environment variable in the second column. When you run `make publish-firefox` or
   `make publish-chrome` outside the workflows, export the environment variables of the second column.

4. Read the current version in the Chrome Web Store developer dashboard. The store accepts only a version
   that is higher than its last upload.

## Make a Release

1. Set the version, commit and tag:

   ```sh
   make release VERSION=0.0.11
   ```

   The command writes the version to `manifest.json`, adds the release to `updates.json`, commits, and makes
   the tag `v0.0.11`. Without `VERSION`, it increases the third version part.

2. Push the commit and the tag:

   ```sh
   git push origin HEAD --follow-tags
   ```

   If the branch is protected, push the commit as a pull request first. Merge it, pull `main`, then tag and
   push the tag.

3. Wait for the release workflow. On a `v*` tag, `release.yml` does these steps:
   - It makes sure that the tag is equal to the version in `manifest.json`.
   - It makes sure that `updates.json` has an entry for the version.
   - It builds the Chrome and Firefox packages with the non-OSS assets.
   - It makes sure that the `suola` artifacts carry the `suola` build attestation.
   - It sends the Firefox package to Mozilla for unlisted signing, with the source code for review.
   - It makes a GitHub Release with the signed `.xpi` and the Chrome `.zip`, and attests both.

4. Write the release notes. Open the new GitHub Release and replace the generated list of pull requests with
   the changelog. AMO shows this text as the release notes of the store version, so write it before you
   publish. The Chrome Web Store has no release notes for a version.

## Publish to the Stores

Each store has its own workflow. The two workflows have the same steps.

1. Open **Actions** on GitHub.
2. Select **Publish to AMO** or **Publish to Chrome Web Store**.
3. Select **Run workflow**. In the branch selector, select the release tag, for example `v0.0.11`.
4. Keep `store_revision` at `1` for the first submission of a tag.
5. Select **Run workflow**.

The workflow installs the store tool and runs `make publish-firefox` or `make publish-chrome`. The make target
builds the store tree, makes sure that the `suola` artifacts carry their attestation, and then uploads the
package. AMO puts the version in its review queue. The Chrome Web Store puts the version in its review queue
when the upload is complete. The workflow does not wait for the review.

The AMO submission carries two texts, from `make amo-metadata`:

- The release notes are the body of the GitHub Release of the tag. The target fails if the Release does not
  exist.
- The notes to the Mozilla reviewer are [docs/amo-reviewer-notes.md](amo-reviewer-notes.md). They tell the
  reviewer how to rebuild the package and how to verify the WebAssembly module. Update the file when the
  build changes.

The Chrome Web Store has no fields for these texts. Update the listing text in the developer dashboard by
hand when it changes.

The workflow refuses to run on a branch. It does not change `updates.json`.

### Publish Again After a Rejection

1. Correct the cause of the rejection. A change to the code needs a new release. A change to the store listing
   does not.
2. If the Chrome Web Store shows a version in review, cancel that review in the developer dashboard.
3. Run the workflow of the rejected store again with a higher `store_revision`. The other store keeps its
   version and its review result.

AMO does not release a version number after use. This includes a rejected or a deleted version. The Chrome Web
Store accepts only a version that is higher than its last upload. Thus only the newest tag can be published
again to the Chrome Web Store. An older tag needs a new release.

### Remove a Bad Build

- Chrome Web Store: unpublish the item in the developer dashboard.
- AMO: disable the version in the Developer Hub.

## Browser Manifests

`manifest.json` is the base for both browsers. The repository root stays a loadable unpacked extension in
Firefox and in Chrome. Two overlays remove the keys that one browser does not accept:

- `manifest.chrome.json` removes `browser_specific_settings`, `background.scripts` and `action.default_area`.
- `manifest.firefox.json` removes `minimum_chrome_version` and `background.service_worker`.

`make dist-chrome` and `make dist-firefox` merge an overlay onto the base with `tools/manifest.mjs`. The merge
has three rules:

1. A key in the overlay replaces the same key in the base. Objects merge level by level.
2. A `null` in the overlay deletes the key.
3. An array in the overlay replaces the whole array.

When you add a key to `manifest.json` that only one browser accepts, put the key in the other browser's
overlay with the value `null`. The test `tests/manifest.test.mjs` compares the merged manifests with the base.

`make store-chrome` and `make store-firefox` make the store trees. They apply the same merge, then set the
store version and remove `update_url`. Do not edit the merged manifests under `build/`. Each build writes them
again.

`make lint-webext` lints the Firefox tree with `--self-hosted`. The flag permits `update_url`, which the
self-hosted `.xpi` needs. The store tree has no `update_url` and lints without the flag.

## Versions and Channels

AMO accepts each version number one time, across the listed and the unlisted channel. The GitHub Release
signs the tag version in the unlisted channel. Thus the store build needs a different version.

The store version is the tag version with a fourth part. The fourth part is the fourth part of the tag, or
zero, plus `store_revision`:

| Tag | `store_revision` | Store version |
|---|---|---|
| `v0.0.11` | 1 | `0.0.11.1` |
| `v0.0.11` | 2 | `0.0.11.2` |
| `v0.0.11.1` | 1 | `0.0.11.2` |

A hotfix tag with a fourth part must not use a number that a store build has used. Check the store versions
before you tag a hotfix.

Firefox and Chrome compare versions part by part. A missing part is equal to zero. Thus `0.0.11.1` is higher
than `0.0.11`, and a store install updates to the next release.

`updates.json` lists only the GitHub-hosted `.xpi` files. A Firefox install from GitHub reads `updates.json`,
because its manifest has `update_url`. A Firefox install from AMO has no `update_url` and reads AMO. A user who
installs a GitHub `.xpi` over an AMO install moves to the GitHub channel. A user who installs from AMO over a
GitHub install moves to the AMO channel.

The AMO listing keeps its license from the previous version. Change the license in the Developer Hub, not in
the pipeline. The key `gecko_android` in `manifest.json` keeps the listing available on Firefox for Android.

## Source for the AMO Review

The release and the AMO submission include the source code as `build/source-code.zip`, from
`git ls-files --recurse-submodules`. The extension contains WebAssembly, so Mozilla reviews the source.

The build command for the reviewer is `make build NON_OSS=1` with Docker. The option `USE_RELEASE_ARTIFACTS=1`
downloads a prebuilt binary and is not for review.
