# Privacy Notice for the Development Versions of Klikkikuri Paatti

*Last updated: October 16, 2026*

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

A **provider** is a set of files that a person or organization other than Klikkikuri publishes. It has a file list and the files that the list names. The files can contain headline corrections, address rules and site configurations, in the same format as Klikkikuri's own files. Klikkikuri's own files are the extension's *default provider*.

The files contain only data (text, page selectors and address patterns). They do not contain program code. **Klikkikuri does not review the files of a provider.** The provider decides which replacement headlines you see on its sites.

### A. When You Add a Provider

1. You enter the address of the provider's file list, and click "Add".
2. If the extension does not have access to that server, the browser asks for your permission.
3. The extension downloads the file list, and the site lists on the same server. It shows you which servers the provider uses and which sites it supplies.
4. You click "Add provider". If the provider uses other servers, the browser asks for your permission for them.
5. The extension downloads the other files.

If you click "Cancel" at step 4, the extension downloads nothing more. The access that you gave at step 2 stays until you remove it in the extension settings of your browser.

### B. Updates

* The extension downloads the provider's files again at each periodic update, until you turn off or remove the provider.
* The extension downloads files only from servers that it has access to in your browser. If the provider changes its file list to name a new server, the extension stops the updates of that provider and keeps the files that it already has. To give access to the new server, click "Grant access" on the provider in the extension settings.

### C. What the Provider's Servers Receive

* The requests are sent **without cookies or credentials** and **without a referrer**. The extension does not follow redirects.
* The servers receive **standard HTTP request metadata**, such as your IP address and browser User-Agent.
* A request for a correction database can repeat two values that the server sent with the copy that the extension already has: a version tag (ETag) and a date (Last-Modified). The server then sends the file only if it has changed. The server chooses these values, so the provider can use them to recognize repeated requests from the same installation.
* The request contains the address that you entered. If a provider gives each person a different address, it can recognize your installation at each update, and see your IP address and when your browser is on.
* The requests contain **no browsing history**, no addresses of pages that you visit, and no headlines.

**Klikkikuri does not receive this data.** The operator of the servers that the file list names decides how it handles the data. Before you add a provider, read its privacy information. Add only providers that you trust.

### D. How the Extension Uses a Provider's Files

* The extension uses the files **only on your device**.
* A site from a provider starts turned off. The extension operates on that site only after you turn it on and the browser gives access to it. Section 3 tells about one exception.
* The extension shows the icons of a provider's sites as the Privacy Policy, Section 2.D, tells.
* The extension settings show the links that the provider's file list gives, for example to its privacy policy. The extension opens a link only when you click it, and sends no referrer.
* Feedback that you send about a site or a headline from a provider goes to Klikkikuri, as the Privacy Policy, Section 2.B, tells. It does not go to the provider.

### E. Storage, Turning Off and Removing

* The extension saves the addresses of your providers in the **sync storage** of your browser. If you use browser sync, the addresses go to your other devices too. On another device, the extension downloads a provider's files only from servers that it has access to on that device. To give access on that device, click "Grant access" on the provider. A store version on another device does not use the provider. Do not use a provider address that contains a password or an access token.
* The extension saves the files that it downloads from a provider in the local storage of your browser.
* When you **turn off** a provider, the extension stops the downloads and does not use the files. The files and the access stay.
* When you **remove** a provider, the extension deletes the files that it downloaded from the provider and the icons of the provider's sites. It also removes the access to servers and sites that only that provider used.

## 3. "Allow Providers to Override Sites"

When this setting is on, a provider can replace the settings and the headline corrections of a site that Klikkikuri's files or an earlier provider already supply. If you turned on that site before, the provider's corrections apply immediately.

This setting is on by default in the "Development" environment, and off in the other environments. The extension saves this setting only on your device. It does not go through browser sync.

## 4. "Allow Providers on This Machine"

When this setting is on, the extension can download a provider's files from a server on your own computer (localhost), also without encryption (http). Keep this setting off unless you operate a provider yourself.

The extension refuses addresses in private networks, for example 192.168.x.x, also when this setting is on. It cannot see that a server name points to such an address.

The extension saves this setting only on your device. It does not go through browser sync.

## 5. Legal Basis

Klikkikuri processes no personal data in connection with the functions in this notice. You choose the provider, and the extension sends the requests from your device directly to the servers that the provider names. Nothing from these requests goes to Klikkikuri.

For the other functions of the extension, see the Privacy Policy, Section 3.B.

## 6. Contact Us

See the Privacy Policy, Section 8.
