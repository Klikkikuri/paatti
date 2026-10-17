# Providers

A **provider** is a set of files that a person or an organization publishes. The files can contain headline corrections, address rules and site settings. Klikkikuri's own files are the **default provider**. The extension adds the default provider automatically. You can add more providers.

Only the version on GitHub, and a version that you build yourself, can use other providers. The settings are in the extension settings, in the section "🔌 Providers". This section shows only in the "Development" environment.

The [Privacy Notice for the Development Versions](PRIVACY_POLICY_DEVELOPMENT.md) tells which data the providers' servers receive and which data the extension keeps. Add only providers that you trust. Klikkikuri does not examine the files of a provider.

## Add a provider

1. Enter the address of the provider's file list (its manifest), and click "Add".
2. If the extension does not have access to that server, the browser asks for your permission.
3. The extension shows the servers that the provider uses, and the sites that it supplies.
4. Click "Add provider". If the provider uses more servers, the browser asks for your permission for them.

If you click "Cancel", the extension does not add the provider.

## Turn on the sites of a provider

A site that a provider supplies is off when you add the provider. The extension does nothing on that site until you turn it on. Turn it on in the site list, as you turn on any other site.

A provider can supply corrections for links to its sites, on all pages. It cannot supply corrections for links to other sites.

## Which correction you see

A headline can have a correction from Klikkikuri and a correction from a provider. The setting "Allow providers to override sites" decides which correction you see:

| Setting | A site of a provider that you turned on |
| --- | --- |
| Off | You see Klikkikuri's correction. If Klikkikuri has no correction, you see the provider's correction. |
| On | You see the provider's correction. If the provider has no correction, you see Klikkikuri's correction. |

If a site of a provider is off, you see only Klikkikuri's corrections for links to that site.

## "Allow providers to override sites"

When this setting is off, a provider cannot supply a site that Klikkikuri or an earlier provider already supplies. The provider shows "Rejected sites", and each rejected site tells which source supplies it.

When this setting is on, a provider can replace the settings of such a site. If you turned on that site before, the provider's settings and corrections apply immediately. If two providers supply the same site, the provider that you added last has priority.

## "Allow providers on this machine"

When this setting is on, the extension can download the files of a provider from a server on your own computer (localhost). Keep this setting off if you do not develop Klikkikuri Paatti or provider.

## The provider list

Each provider shows its sites, the time of its last update, and its problems:

- **Needs access**: the provider uses a server that the extension does not have access to. The extension does not update the provider. Click "Grant access" to give the access.
- **Fetch failed**: the last update failed. The extension keeps the files that it has.
- **Errors**: the extension could not use some files of the provider.
- **Rejected sites**: the extension did not use some sites of the provider.
- **Not in this build**: this version of the extension cannot use the provider.

"Remove" deletes the provider and its files. You cannot remove the default provider. You can turn it off.

---

## Technical details

This part tells how the extension reads and uses a provider. The code is in `src/provider.js` (the manifest and its resources), `src/providers.js` (the provider list, the refresh and the Suola rule sets), `src/config.js` (the merged configuration) and `src/model.js` (the lookup).

### The manifest

The manifest is a JSON object:

| Field | Content |
| --- | --- |
| `schema_version` | Must be compatible with `0.1.0`: the same major version, and the same minor version while the major version is 0. |
| `name` | The name that the provider list shows. |
| `updated` | The date of the manifest. |
| `links` | Links that the provider list shows, for example to a privacy policy. Each link has `rel` and an absolute `http(s)` `href`. Other links are ignored. |
| `resources` | The list of resources. 32 resources at most. |

Each resource has a `type`. It has an `href` (one URL or a list), an inline payload, or both. A relative `href` is relative to the manifest URL. A resource can also have `weight` (an integer, 0 or more, default 0), `description` and, for `site-configs`, `origins`.

| `type` | Inline key | Merge rule |
| --- | --- | --- |
| `suola-rules` | `rules` | The `sites[]` arrays are joined in order. The result is the provider's Suola rule set. |
| `rahti-data` | `data` | The entries are keyed by `urls[].sign`. A later entry replaces an earlier entry with the same sign. |
| `site-configs` | `sites` | For each site key, `rules`, `origins` and `links` are joined without duplicates. A later value replaces the other fields. |

The extension ignores a resource of an unknown type (for example an `x-` type) and does not download it. Resources are merged in `weight` order, from low to high, and in document order when the weights are equal.

### Downloads

The extension downloads a provider in two steps:

1. Before you confirm, it downloads only the manifest and the `site-configs` documents on the same origin as the manifest. The confirmation shows every origin that the manifest names.
2. After you confirm and the browser gives access, it downloads all the resources.

Limits:

- The manifest can be 256 KB at most, and a resource document 8 MB at most. One refresh downloads 32 resource documents at most.
- A request stops after 10 seconds.
- A remote server must use `https`. Only a loopback address can use `http`, and only when "Allow providers on this machine" is on.
- The extension refuses private and reserved addresses. It does not follow redirects. It sends no cookies, no credentials and no referrer.
- The extension sends no request to an origin that the browser has not given access to.

The extension keeps the last good copy of each document. It uses that copy after a temporary failure and after an HTTP 304. A temporary failure is a timeout, a network failure, a redirect, or HTTP 408, 425, 429 or 5xx. After a permanent failure, the extension merges nothing from that document. If the manifest download fails, the provider keeps the content that it had.

Only `rahti-data` documents use conditional requests (`If-None-Match` and `If-Modified-Since`). [fingerprinting.md](fingerprinting.md) tells why.

The extension refreshes the providers at each periodic update, one after the other, in list order. If a default provider fails temporarily, the extension tries again after 30 seconds, then after 60 seconds. A server's `Retry-After` can make the wait longer. Other providers wait for the next periodic update.

### Sites

The extension refuses a site from a provider when:

- the site key is not a bare hostname (no scheme, path, port or `*`);
- the site's `origins` are not exactly `https://<key>/*` or `http://<key>/*` (the default is `https://<key>/*`);
- the `site-configs` resource is on a different origin than the manifest, and the resource's `origins` do not include the site's hosts. Such a resource must declare `origins`. A resource on the same origin must not declare them;
- Klikkikuri or an earlier provider already supplies the site, and "Allow providers to override sites" is off. For a default provider, the bundled sites do not count, because the default provider publishes them.

A site with `enabled: false` in a provider's files is not offered. A site with `enabled: true` is offered, but it is off until you turn it on. This is not true for a default provider: its sites keep their own `enabled` value, as the bundled sites do.

The extension hides a site whose origins this version cannot request. A store version, for example, can request only the origins that its manifest declares.

### Signs and lookups

A Rahti entry is keyed by a sign: a hash of the link address, made with Suola rules. The extension finds the entry for a link in these steps:

1. It finds the site of the link's host. It does not use the page's host. Thus a provider cannot answer for links to sites that it does not supply.
2. It makes a list of the sources for that host, in the order of the table in [Which correction you see](#which-correction-you-see). A provider is in the list only when you turned its site on and the provider's own origins cover the host. Each enabled default provider is in the list. A later default provider comes before an earlier one.
3. It makes a sign for each source:
   - A source that supplies the host and has Suola rules uses its own named rule set. The name is the manifest URL. A named rule set cannot change the signs of the built-in rules.
   - If Suola refused the rules of that source, the source gets no sign and the extension skips it. A sign made with the wrong rules would look correct and find wrong entries.
   - All other sources use the built-in rules.
4. It looks up each sign in the data of its own source. The first entry that it finds is the result.

The **official sign** is the sign of the first default provider in the list. If no default provider is enabled, or if Suola refused the rules of that provider, it is the sign of the built-in rules. The extension stores it on the link and sends it with feedback and in the statistics. Thus it does not change when a provider starts or stops covering a link.

### Storage

| Storage | Key | Content |
| --- | --- | --- |
| sync | `providers` | The list of `{ url, enabled }`, 17 entries at most. The default providers are first, in the order of the environment's `defaultProviders`. The other providers follow in the order that you added them. |
| local | `provider:<manifest URL>` | What the provider resolved to: sites, Rahti data, Suola rules, rejected sites, errors and times. |
| local | `provider:<manifest URL>_documents` | The last good copy of each document. |

`updated` changes only after a refresh with no download error. `checked` changes after each attempt. The extension reads the data of all enabled providers in one storage read when it loads its configuration, and it keeps that data until the configuration changes.

**Memory use.** Each part of the extension that loads the configuration keeps its own copy of that data: the background service worker, the settings page, the popup, and the content script in each tab that shows a supported site. The copy contains the Rahti data of each enabled provider. The copy of the default provider's data is about 380 KB as JSON (854 entries, October 2026), and the objects in memory are larger than their JSON. A provider with a large data set adds the same quantity to each of these copies. In exchange, the lookup for a page of links does not read storage. The document copies (`_documents`) are not in the configuration.

A store version does not have the optional `*://*/*` host permission. Thus it uses only its default providers, also when browser sync brings in a provider from another browser. That provider shows "Not in this build".
