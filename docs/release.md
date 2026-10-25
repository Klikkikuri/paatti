# Release and Publish

This document tells you how to make a release of Klikkikuri Paatti and how to publish it to the browser stores.

## Overview

Paatti has two distribution channels. A release goes to the first channel. Publishing sends the same release
to the second channel.

| Channel | Command | Version | Update source | Record in the repository |
|---|---|---|---|---|
| GitHub Release | `make release`, then a `v*` tag | `X.Y.Z` or `X.Y.Z.W` | `updates.json` (Firefox) | `manifest.json`, `updates.json` |
| Stores (AMO, Chrome Web Store) | The "Publish to AMO" and "Publish to Chrome Web Store" workflows | `X.Y.Z.N`, see [Versions and Channels](#versions-and-channels) | The store | None |

The GitHub Release carries a signed Firefox `.xpi` for self-hosted installs and a Chrome `.zip`. The stores
carry their own copies with a store version. Publishing does not change `updates.json`.

## Before You Start

1. Make sure that `main` is clean and up to date.
2. Make sure that the `suola` submodule is at a released tag with a GitHub Release. See
   [Submodule Pointers](#submodule-pointers).
3. Run `make check-sites-latest`. If it reports that the origins differ, Rahti has changed the sites: run
   `make sites-sync`, then commit and push the result. If it fails with a network or git error, run it again.
   See [Default Site Permissions](#default-site-permissions).
4. Make sure that the repository has these secrets under **Settings → Secrets and variables → Actions**. A
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
   `make publish-chrome` outside the workflows, export the environment variables of the second column. The
   targets also use GitHub CLI: run `gh auth login`, or export `GH_TOKEN`.

5. Read the current version in the Chrome Web Store developer dashboard. The store accepts only a version
   that is higher than its last upload. Use it to select `store_revision`, and the number of a hotfix tag. See
   [Versions and Channels](#versions-and-channels).

## Submodule Pointers

Paatti has two submodules. They serve different jobs.

| Submodule | What it provides | Ships in |
|---|---|---|
| `suola` | `js.wasm` and `wasm_exec.js` | The extension package and the source archive |
| `packages/karikko` | The development server that the tests start | The source archive only |

A release ships the `suola` release of the pinned tag. Thus a commit that goes to `main` must point `suola`
at a released tag, because `main` must stay releasable. A branch does not have that limit: it may point
either submodule at any commit. `packages/karikko` has no release artifact, so any of its commits is allowed
on every branch.

| Event | `suola` | `packages/karikko` |
|---|---|---|
| Push to a branch other than `main` | Any commit | Any commit |
| Pull request into `main` | Released tag with `js.wasm` and `wasm_exec.js` | Any commit |
| Push to `main` | Released tag with `js.wasm` and `wasm_exec.js` | Any commit |
| `v*` tag, store publish | Released tag with `js.wasm` and `wasm_exec.js` | Any commit |

Two workflows apply the rule:

- `build.yml` tests any commit. When the pointer is not a released tag, its job summary says that the module
  was built from source, so the check does not claim that the commit can be released. On an event that
  targets `main` it stops instead of building.
- `release-checks.yml` runs on a pull request into `main` and on a push to `main`. It calls
  `make check-submodule-pointers`. Add this check to the branch protection rule.

`make check-suola-release` is the `suola` predicate. A release, a store build and the Build workflow all call
it, so the rule has one definition.

## Make a Release

1. Set the version, commit and tag:

   ```sh
   make release VERSION=0.0.11
   ```

   The command writes the version to `manifest.json`, adds the release to `updates.json`, commits, and makes
   the tag `v0.0.11`. Without `VERSION`, it uses the version in `manifest.json`. If the tag of that version
   exists, it increases the third version part and removes a fourth part: `0.0.10.1` becomes `0.0.11`.

2. Push the commit and the tag:

   ```sh
   git push origin HEAD --follow-tags
   ```

   If `main` is protected, push the commit without the tag, and merge it through a pull request. The merge can
   change the commit, so make the tag again on the merged commit:

   ```sh
   git push origin HEAD:release-v0.0.11      # then open and merge the pull request
   git tag -d v0.0.11
   git pull origin main
   git tag -a v0.0.11 -m "Release v0.0.11"
   git push origin v0.0.11
   ```

3. Wait for the release workflow. On a `v*` tag, `release.yml` does these steps:
   - It makes sure that the tag is equal to the version in `manifest.json`.
   - It makes sure that `updates.json` has an entry for the version.
   - It runs `make check-sites` and `make check-sites-published`: it compares the origins in
     `manifest.json` with `sites.lock.json`, and the lock with its Rahti commit. See
     [Default Site Permissions](#default-site-permissions).
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
3. Select **Run workflow**. This opens the form. In the branch selector, select the release tag, for example
   `v0.0.11`. The workflow refuses to run on a branch.
4. Keep `store_revision` at `1` for the first submission of a tag.
5. Select **Run workflow** in the form.

The workflow installs the store tool and runs `make publish-firefox` or `make publish-chrome`. The make target
does these steps:

1. It makes sure that the tag has its GitHub Release. `release.yml` makes the Release only after the sites
   check passes. Do not make a Release by hand: the target cannot tell it from a Release of `release.yml`.
2. It builds the store tree.
3. It makes sure that the `suola` artifacts carry their attestation.
4. It uploads the package.

AMO puts the version in its review queue. The Chrome Web Store puts the version in its review queue when the
upload is complete. The workflow does not wait for the review.

The AMO submission carries two texts, from `make amo-metadata`:

- The release notes are the body of the GitHub Release of the tag. The target fails if the Release does not
  exist.
- The notes to the Mozilla reviewer are [docs/amo-reviewer-notes.md](amo-reviewer-notes.md). They tell the
  reviewer how to rebuild the package and how to verify the WebAssembly module. Update the file when the
  build changes.

The Chrome Web Store has no fields for these texts. Update the listing text in the developer dashboard by
hand when it changes.

The workflow does not change `updates.json`.

### Upload by Hand

When a workflow is not available, build the store packages in the dev container (`.devcontainer/`) and upload
them in the store dashboards:

1. Check out the release tag. The packages carry the version of `manifest.json` plus the store revision.
2. Remove the old build output. A store build keeps a `build/js.wasm` that is newer than the `suola` source,
   also a module that you compiled yourself:

   ```sh
   make clean
   ```

3. Build the packages, and make sure that the `suola` artifacts carry their attestation:

   ```sh
   make store-build STORE_REVISION=1
   make verify-suola
   ```

   `make verify-suola` binds the attestation to the commit that the `suola` submodule pins, so it needs that
   git checkout. It stops with a clear error when the checkout is absent.

4. Upload the files directly. Do not run another make target before the upload (see below).

The command writes three files under `build/`:

| File | Upload to |
|---|---|
| `klikkikuri-paatti-firefox.zip` | AMO Developer Hub, as the new version. Attach `source-code.zip` as the source. Paste the release notes and the text of `docs/amo-reviewer-notes.md`. |
| `klikkikuri-paatti-chrome.zip` | Chrome Web Store developer dashboard, as the new package. |
| `source-code.zip` | AMO, with `klikkikuri-paatti-firefox.zip`. |

A store build always includes the non-OSS assets. When `build/js.wasm` is missing or older than the `suola`
source, it downloads the `suola` artifacts of the pinned tag; it does not compile `suola`.

A store build runs `make check-sites` first. It does not connect to Rahti. See
[Default Site Permissions](#default-site-permissions).

The two zip files have the same names as the output of `make package` and `make build`, which write the GitHub
channel builds. The file on disk is the output of the make target that ran last. Run `make store-build`
directly before an upload, and do not run another make target in between.

### Publish Again After a Rejection

1. If the Chrome Web Store shows a version in review, cancel that review in the developer dashboard.
2. Correct the cause of the rejection:
   - A change to the code needs a new release. Make it, then publish the new tag with `store_revision` `1`.
   - A change to the release notes only: edit the GitHub Release, then run the workflow of the rejected store
     again on the same tag, with a higher `store_revision`. The other store keeps its version and its review
     result.
   - A change to the store listing only: change it in the dashboard. It needs no new upload.

AMO accepts a version number one time only. This includes a rejected or a deleted version. The Chrome Web
Store accepts only a version that is higher than its last upload. Thus only the newest tag can be published
again to the Chrome Web Store. An older tag needs a new release.

### Remove a Bad Build

- Chrome Web Store: unpublish the item in the developer dashboard.
- AMO: disable the version in the Developer Hub.

## Default Site Permissions

The extension contains no sites. It downloads the default sites from the default provider (Rahti's provider
manifest) at runtime, like the sites of any other provider. But a store build can request only the origins that
`manifest.json` declares, so `manifest.json` must declare the origins of the default sites.

`make sites-sync` resolves the default provider manifest and writes these origins into `manifest.json`. It also
writes `sites.lock.json`: the manifest URL, the Rahti commit, and the enabled and disabled origins. The checks
below compare with this lock. The header of `tools/sites.mjs` tells why each field is necessary. The extension does
not read the lock, and the packages do not contain it. A developer runs the sync and commits both files. No
workflow writes them.

The checks compare only the origins and the `enabled` state of the sites. A change to the rules of a site does not
change `manifest.json`, so it needs no sync.

Rahti `main` changes many times each hour. Thus the checks compare with the pinned commit, not with `main`, and a
given Paatti commit always gets the same result. A retry, or the second store, cannot fail because Rahti changed.
While the origins stay the same, a new sync keeps the pinned commit, so it gives no diff.

| Check | Where it runs | It stops if |
|---|---|---|
| `make check-sites` | `make test`, every store build, `release.yml` | See the list below. |
| `make check-sites-published` | `build.yml`, `release.yml` | The lock is not from the default provider manifest, or records no commit. The pinned commit is not in the history of Rahti `main`. The origins at that commit differ from the lock. The GitHub API gives an error. |
| `make check-sites-latest` | `sites-latest.yml`, each day; by hand, before a release | The lock is not from the default provider manifest. The origins on Rahti `main` now differ from the lock. |

`make check-sites` stops if:

- The lock is not from the default provider manifest, records no commit, or its origins are not sorted and
  without duplicates.
- A site origin in `manifest.json` does not agree with the lock.
- A site origin that was optional in the previous release is in `host_permissions`. A new required host
  permission makes Chrome disable the extension at update. [Adding a new site](development/adding-a-new-site.md)
  tells which origins are required.

`make check-sites` does not connect to the network. It reads the previous release from the last `v*` tag before
`HEAD`. In CI, a missing tag is an error. Outside CI, a missing tag (in a source archive, or in a clone without
tags) gives a warning, and the check uses the committed `manifest.json` as the previous release. Then it cannot
find an optional origin that became required.

`make check-sites-published` uses the GitHub API to find the commit in the history of `main`, because
raw.githubusercontent.com also gives the files of a commit in a fork. It sends `GITHUB_TOKEN` when the variable is
set; without it, the API rate limit can stop the check. If Rahti removes the commit from its history, the check
fails for each later run. Then run `make sites-sync` and release a new version.

A failed run of `sites-latest.yml` blocks nothing. It tells you that a new release does not have the current sites:
run `make sites-sync` and commit the result. GitHub sends the failure only to the user who last changed the `cron`
line of the workflow. GitHub also disables the schedule after 60 days with no activity in the repository. Enable
it again in **Actions**.

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
store version, remove `update_url`, and remove the wildcard `*://*/*` from `optional_host_permissions` and the
`web_accessible_resources` group that matches it. The wildcard lets the GitHub build add a provider on any host,
and a store review flags it. They set `NON_OSS=1` and `USE_RELEASE_ARTIFACTS=1` themselves. Do not edit the
merged manifests under `build/`. Each build writes them again.

`make lint-webext` lints the Firefox tree with `--self-hosted`. The flag permits `update_url`, which the
self-hosted `.xpi` needs. No make target lints the store tree.

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

The reviewer compiles `suola` with `make build-suola-local` (with Docker), then builds the package with
`make store-firefox STORE_REVISION=<n>`. The store build keeps the compiled module, because it is newer than the
`suola` source. [docs/amo-reviewer-notes.md](amo-reviewer-notes.md) gives the steps to the reviewer.
