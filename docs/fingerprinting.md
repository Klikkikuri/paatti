# How Paatti prevents fingerprinting

A fingerprint is a value that makes one user different from all other users. A web page reads such a value
and then follows the user from visit to visit. A fingerprint is stronger than a cookie, because the user
cannot delete it.

Paatti gives no fingerprint to the pages that you visit.

## A page can see the extension. It cannot see you.

Paatti changes the pages that it supports. It adds a badge to a headline. It writes `data-klikkikuri-*`
attributes on each element that it changes. A page finds these changes easily. Thus a page knows that
Paatti is installed.

We accept this. The extension must change the page, because that is its function.

These changes are not a fingerprint. All users get the same badges and the same attributes. The changes
tell a page about the extension. They tell a page nothing about the user.

This gives the rule that the design obeys:

> A value that enters the page must be the same for all users. A value that is different for each
> installation must stay out of the page.

## The address of the extension stays out of the page

Firefox makes a different address for each installation:

    moz-extension://<uuid>/...

Two users never have the same `uuid`. The `uuid` does not change when the user deletes the cookies, or
clears the browser data. A page that reads this address follows the user for as long as the installation
continues. One line of code is sufficient to read it:

```js
document.querySelector('script[src^="moz-extension://"]')
```

Chrome is different. Chrome gives the same address to all installations of the same extension. Therefore
the address shows only that the extension is installed.

Paatti puts no extension address in the page, in either browser.

## The content script builds the badges

A badge is a web component. Usually a web component needs a registration in the registry of the page. To
make that registration, an extension must put a `<script>` element in the page. The `src` of that script
is the address above. Thus the registration would put the address in front of every page.

Paatti does not make this registration. The content script makes the badge element itself, and attaches
the shadow root itself. This work stays in the isolated world, which is the private area that the browser
gives to a content script. A page cannot read the isolated world.

The badge tag stays unregistered in the page. A page sees an element and a shadow root. It does not see
where they came from.

The debug highlight uses the same method, for the same reason.

## Requests to other servers

Paatti makes three types of request. Each one obeys the same three rules:

* It sends no cookies (`credentials: "omit"`).
* It sends no referrer (`referrerPolicy: "no-referrer"`).
* It adds no parameter that identifies the user.

**The headline database.** Paatti gets a static file from a public address. The request has no query
parameters. It can carry an `If-None-Match` or an `If-Modified-Since` header, so that the server can
answer "not modified" and save the download. These headers identify the version of the database. All
users who hold the same version send the same values.

**A favicon.** The page supplies the address of its icon. Therefore the extension does not trust it. The
worker takes the name of the site from the sender of the message, and never from the message. The worker
also sends the request through `src/safe-fetch.js`, which refuses a private or local address. Thus a page
cannot use the extension to examine the network of the user.

**Feedback.** Paatti sends feedback only when the user pushes the button. Before it sends the address of
the page, it removes the tracking keys from that address: each `utm_*` key, and the other keys in the
list in `src/utils.js`.

## What a page cannot do

* A page cannot send a message to the extension. The manifest declares no `externally_connectable` key.
* The content script runs only on the sites that the user enabled. On all other sites, no part of the
  extension is present.
* Paatti sends no statistics and no telemetry. The counts stay in the local storage of the browser.
* Paatti puts no random value in the page. The identifiers that mark a headline are counted from zero on
  each page (`kk-hl-0`, `kk-hl-1`), so they are the same for all users and do not continue after the
  page closes.

---

## Notes for developers

`buildBadge` in `src/components/badge-base.js` is the only function that makes a badge for a page that
the extension does not own. Keep it that way. If a future change registers a badge in the registry of the
page, the address of the extension goes back into the page, and the fingerprint returns.

The badge modules export their markup and their label. They register nothing when they are imported. A
content script must be able to read the markup of a badge without a registration: Firefox gives the
isolated world a registry, and an upgrade there fights the element that `buildBadge` makes. The pages of
the extension register the badges themselves, in
`src/options/components/title-modifier-setting.js`.

`AGENTS.md` records what each browser does with the registry and with constructable stylesheets in a
content script. These were measured in Chromium and in Firefox, not assumed.
