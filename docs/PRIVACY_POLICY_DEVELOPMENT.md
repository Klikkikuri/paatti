# Privacy Notice for the Development Versions of Klikkikuri Paatti

*Last updated: October 17, 2026*

This notice adds to the [Privacy Policy](PRIVACY_POLICY.md). It applies only to these versions of the extension:

* the version that is distributed on GitHub, and
* a version that you build yourself from the source code.

The Privacy Policy applies to these versions too. This notice tells you about the functions that only these versions have. The versions in the Chrome Web Store and Firefox Add-ons do not have these functions.

## 1. Development Mode

* The functions in this notice are in the extension settings, in the section "Debug Settings". This section shows only when you select the environment "Development".
* A version that you load from the source code as an unpacked extension starts in the "Development" environment.
* In the "Development" environment, the extension downloads its files every minute.
* In the "Development" environment, the setting "Allow providers to override sites" is on by default (Section 3).

## 2. Providers

A **provider** is a set of files that a person or organization other than Klikkikuri publishes. Klikkikuri's own files are the extension's *default provider*. [Providers](providers.md) tells how providers operate and which corrections you see.

The files contain only data (text, page selectors and address patterns). They do not contain program code. **Klikkikuri does not review the files of a provider.**

### A. When You Add a Provider

* The extension downloads the file list, and the site lists on the same server, **before** you confirm the provider. The browser asks for your permission for that server first.
* The extension downloads the other files only after you confirm. If the provider uses other servers, the browser asks for your permission for them.
* If you cancel, the extension downloads nothing more. The access that you gave for the first server stays until you remove it in the extension settings of your browser.

### B. Updates

* The extension downloads the provider's files again at each periodic update, until you turn off or remove the provider.
* The extension downloads files only from servers that it has access to in your browser. If the provider's file list names a new server, the extension does not contact that server until you give access to it.

### C. What the Provider's Servers Receive

* The requests are sent **without cookies or credentials** and **without a referrer**. The extension does not follow redirects.
* The servers receive **standard HTTP request metadata**, such as your IP address and browser User-Agent.
* A request for a correction database can repeat two values that the server sent with the copy that the extension already has: a version tag (ETag) and a date (Last-Modified). The server then sends the file only if it has changed. The server chooses these values, so the provider can use them to recognize repeated requests from the same installation.
* The request contains the address that you entered. If a provider gives each person a different address, it can recognize your installation at each update, and see your IP address and when your browser is on.
* The requests contain **no browsing history**, no addresses of pages that you visit, and no headlines. The only exception is **Send page** in Section 4, which you start yourself.

**Klikkikuri does not receive this data.** The operator of the servers that the file list names decides how it handles the data. Before you add a provider, read its privacy information. Add only providers that you trust.

### D. How the Extension Uses a Provider's Files

* The extension uses the files **only on your device**.
* The extension reads the pages of a site from a provider only after you turn the site on and the browser gives access to it. Section 3 tells about one exception.
* The extension shows the icons of a provider's sites as the Privacy Policy, Section 2.D, tells.
* The extension settings show the links that the provider's file list gives, for example to its privacy policy. The extension opens a link only when you click it, and sends no referrer.
* Feedback that you send about a site or a headline from a provider goes to Klikkikuri, as the Privacy Policy, Section 2.B, tells. It does not go to the provider.

### E. Storage, Turning Off and Removing

* The extension saves the addresses of your providers in the **sync storage** of your browser. If you use browser sync, the addresses go to your other devices too. On another device, the extension downloads a provider's files only from servers that it has access to on that device. A store version on another device does not use the provider. Do not use a provider address that contains a password or an access token.
* The extension saves the files that it downloads from a provider in the local storage of your browser.
* When you **turn off** a provider, the extension stops the downloads and does not use the files. The files and the access stay.
* When you **remove** a provider, the extension deletes the files that it downloaded from the provider and the icons of the provider's sites. It also removes the access to servers and sites that only that provider used.

## 3. "Allow Providers to Override Sites"

When this setting is on, a provider can take over a site that Klikkikuri's files or an earlier provider already supply. If you turned on that site before, the extension uses the provider's files on that site immediately, without a new confirmation. [Providers](providers.md) tells which corrections you then see.

This setting is on by default in the "Development" environment, and off in the other environments. The extension saves this setting only on your device. It does not go through browser sync.

## 4. "Allow Providers on This Machine"

When this setting is on, the extension can download a provider's files from a server on your own computer (localhost), also without encryption (http).

The extension refuses addresses in private networks, for example 192.168.x.x, also when this setting is on. It cannot see that a server name points to such an address.

The extension saves this setting only on your device. It does not go through browser sync.

When this setting is on and a provider on your own computer names a capture address, the popup's developer settings show a **Send page** button. Only when you select it, the extension sends the address of the page and the links and headlines on it to that address. The extension refuses a capture address that is not on your own computer. This is a tool for people who develop Klikkikuri Paatti or a provider.

## 5. Legal Basis

Klikkikuri processes no personal data in connection with the functions in this notice. You choose the provider, and the extension sends the requests from your device directly to the servers that the provider names. Nothing from these requests goes to Klikkikuri.

For the other functions of the extension, see the Privacy Policy, Section 3.B.

## 6. Contact Us

See the Privacy Policy, Section 8.
