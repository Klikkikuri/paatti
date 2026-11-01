# Architecture

This diagram shows the modules of the Klikkikuri Paatti extension and the paths between them. It is maintained
by hand. If you change a module boundary, update it here.

Terms used below:

- **Provider** is a set of files that a **provider manifest** lists: site configs, Suola rules and Rahti data.
  The extension downloads each enabled provider and reads it locally. See [providers.md](providers.md). Do not
  mix up a provider manifest with the extension manifest, `manifest.json`.
- **Rahti** is Klikkikuri's data repository. Its provider manifest is the **default provider**. **Rahti data**
  (`data.json`, type `rahti-data`) is the correction database format, which any provider can publish. See
  [rahti](https://github.com/Klikkikuri/rahti).
- **Suola** is the WebAssembly module that normalizes and hashes URLs. The backend and the extension use the
  same module, so both sides agree on the **sign** (the hash) of a link. Its built-in normalization rules live in
  `suola/rules.yaml`. A provider can add its own named rule set. See [suola](https://github.com/Klikkikuri/suola).
- **Environment** is the stored user preference (`userPreferences.environment`: `free`, `paid`, or `development`)
  that picks the default providers and settings. It is not the **development server** (karikko, `make serve`),
  which runs on the developer's machine. The development environment makes the server reachable as a loopback
  provider; neither implies the other — see README.md, section "Development Server". Keep the prefixes straight:
  `devserver` names the server, `dev-capture` names the extension feature, and the content-script command is
  `capturePage`.

`src/provider.js` reads one provider manifest. `src/providers.js` keeps the provider list, refreshes each provider
into its own storage namespace, and installs each provider's Suola rules. `getConfig()` merges the data of the
enabled providers. For each link, the service worker makes one sign for each source in the precedence list of the
link's host (`signUrls()`). A provider with its own Suola rule set gets its own sign. The other sources share the
sign of the built-in rules. The content script looks up those signs (`getRahtiEntries()`).
[providers.md](providers.md#signs-and-lookups) tells the order of the sources.

When a developer runs `make sites-sync`, `tools/sites.mjs` resolves the default provider with `src/provider.js`.
It writes the site origins into `manifest.json`, because a store build can request only the origins that
`manifest.json` declares, and pins the Rahti commit in `sites.lock.json`. The extension contains no sites.

The popup and the in-page feedback card do not call the feedback server themselves. Both build the feedback
payload and give it to the service worker. The service worker builds the request from its configuration and makes
the one network call. `src/feedback.js` explains why.

| Class | Source |
|---|---|
| `BrowserStorage` | The `browser.storage` API |
| `Storage` | `src/storage.js` |
| `Model` | `src/model.js` |
| `Config` | `src/config.js` |
| `Controller` | `src/controller.js` |
| `ProvidersModule` | `src/providers.js` |
| `ProviderResolver` | `src/provider.js` |
| `SafeFetch` | `src/safe-fetch.js` |
| `Origins` | `src/options/origins.js` |
| `FaviconFetch` | `src/favicon-fetch.js` |
| `Feedback` | `src/feedback.js` |
| `BackgroundScript` | `src/background.js` (the service worker) |
| `ContentScript` | `src/contentScript.js` |
| `FeedbackDialog` | `src/components/feedback-dialog.js` |
| `StatsModule` | `src/stats.js` |
| `Modifiers` | `src/modifiers.js` |
| `SuolaWasm` | The globals of the `suola` WebAssembly module (`build/js.wasm`) |
| `Popup` | `src/options/popup.js` and the components that it imports |
| `OptionsUI` | `src/options/options.js` and `src/options/components/` |

In the diagram, a solid arrow is an import or a call, a dotted arrow is a network request, and `*--` means that
the module embeds the other one. A member in the form `action: name` is a runtime message, not a function.

```mermaid
---
title: Architecture v0.0.10.1
---
classDiagram
    direction TB
    class BrowserStorage {
        +local
        +sync
    }
    class Storage {
        +initStorage(ns)
        +get(key)
        +set(key, value)
        +store(entries)
        +remove(keys)
        +prune()
    }
    class Model {
        +read
        +write
        +watch
        +signUrls(config, urls, suola)
        +read.getRahtiEntries(signsByUrl)
        +write.addStatistics(delta, options)
        +watch.onDatabaseStatusChanged(callback)
    }
    class Config {
        +enabled
        +activeEnv
        +siteConfigs
        +siteConfigSources
        +providerData
        +enabledDefaultProviderUrls
        +getConfig()
        +onConfigValue(select, callback)
        +isUsableProvider(url, defaultProviders)
    }
    class Controller {
        +setEnabled(value)
        +setSiteEnabled(value, hostname)
        +setEnvironment(value)
        +setClickbaitLevel(value)
        +acknowledgeClickbaitLevelWarning()
        +setModifierEnabled(name, value)
        +setDebugVisualsEnabled(value)
        +setVisualHighlightEnabled(value)
        +setEasterEggProbability(value)
        +setRefreshIntervalMinutes(value)
        +setProviderShadowingEnabled(value)
        +setLoopbackProvidersEnabled(value)
        +updateStatistics(update)
        +resetStatistics()
        +devmode.capturePage()
    }
    class ProvidersModule {
        +getProviders()
        +addProvider(url)
        +removeProvider(url)
        +setProviderEnabled(url, enabled)
        +getProviderData(url)
        +seedDefaultProviders(defaultUrls)
        +refreshProviders(options)
        +retryDelayMs(results, defaultUrls, attempt, intervalMs)
        +reconcileSuolaRules()
        +dropStaleProviderData()
    }
    class ProviderResolver {
        +fetchManifest(url, loopbackProvidersEnabled)
        +inspect(manifestUrl, options)
        +resolve(manifest, manifestUrl, options)
        +resourceOrigins(manifest, manifestUrl)
    }
    class SafeFetch {
        +safeFetch(url, options)
        +readCapped(response, maxBytes)
        +blockReason(url, options)
        +isLoopbackHost(hostname)
    }
    class Origins {
        +canAddProviders(manifest)
        +canRequestOrigins(origins, manifest)
        +missingOrigins(urls, contains)
        +originPatterns(urls)
    }
    class FaviconFetch {
        +storeFavicon(senderUrl, faviconUrl)
    }
    class Feedback {
        +buildFeedbackPayload(fields)
        +buildFeedbackRequest(feedbackServerUrl, payload)
    }
    class BackgroundScript {
        +updateDynamicContentScripts()
        +seedAndRefresh(reason, attempt)
        +refreshAndScheduleRetry(options, attempt)
        +isDatabaseStale()
        +alarms
        +initSuola()
        +reconcileSuola()
        +action: hashUrls
        +action: updateDatabase
        +action: submitFeedback
        +action: storeFavicon
    }
    class ContentScript {
        +MutationObserver
        +processSite()
        +command: convertClickbaits
        +command: getConversions
        +command: capturePage
    }
    class FeedbackDialog {
        +createFeedbackDialog(options)
        +open(target, activator)
        +close()
    }
    class StatsModule {
        +buildPageSnapshot()
        +computeGaugeValue()
        +mergeStats()
        +createSessionTracker()
    }
    class Modifiers {
        +titleModifiers
        +applyModifiers(titleText, rahtiEntry)
    }
    class SuolaWasm {
        +hashUrl(url, name)
        +defineRules(name, rules)
        +dropRules(name)
        +listRules()
    }
    class Popup {
        +HomeView
        +StatsView
        +FeedbackView
        +SettingsView
    }
    class OptionsUI {
        +MasterSwitch
        +ThresholdSlider
        +SiteList
        +ProvidersSetting
        +DebugSettings
    }
    class FeedbackServer {
        +submitFeedback()
    }
    class ProviderServer {
        +manifest_json
        +sites_json
        +data_json
        +suola_rules
    }

    Storage --> BrowserStorage : Reads/writes namespaced keys
    Model --> BrowserStorage : Reads/writes preferences & stats
    Config --> BrowserStorage : Merges defaults, overrides & provider data
    Config --> Origins : Drops providers & sites this build cannot use

    Controller --> Model : Orchestrates state updates
    Model --> Config : Reads sites & provider data
    Model --> StatsModule : Merges cumulative stats

    BackgroundScript --> Config : Reads enabled origins
    BackgroundScript --> Controller : Turns a site on or off when a permission changes
    BackgroundScript --> ProvidersModule : Requests refreshes & Suola rule sets
    ProvidersModule --> Storage : Stores each provider's data & documents
    ProvidersModule --> Config : Reads the provider list & claimed sites
    ProvidersModule --> Origins : Checks granted origins
    ProvidersModule --> ProviderResolver : Resolves each provider manifest
    ProvidersModule --> SuolaWasm : Defines & drops named rule sets
    ProviderResolver --> Origins : Checks hosts
    ProviderResolver --> SafeFetch : Fetches the provider manifest & resources
    SafeFetch ..> ProviderServer : Fetch updates

    ContentScript --> Model : Looks up Rahti entries by sign
    ContentScript --> Modifiers : Applies active transformations
    Modifiers --> Model : Reads modifier toggle preferences
    ContentScript --> BackgroundScript : Requests batch URL hashing & favicon storage
    BackgroundScript --> Model : Signs each URL for its host's sources
    BackgroundScript --> ContentScript : Tells the active tab to re-convert
    BackgroundScript --> SuolaWasm : Instantiates & runs Go Wasm
    BackgroundScript --> FaviconFetch : Stores a site's icon
    FaviconFetch --> SafeFetch : Downloads the icon
    ContentScript --> Controller : Updates active page stats
    ContentScript --> StatsModule : Computes session delta & snapshot
    ContentScript *-- FeedbackDialog : Opens from the converted marker
    Controller --> ContentScript : Requests the link signs (developer mode)
    Popup --> StatsModule : Computes gauge values

    Popup *-- Controller : Dispatches user preferences
    Popup *-- Model : Reads stats
    Config --> Popup : Publishes changed values
    Popup --> ContentScript : Port & messages (conversions, highlights)

    FeedbackDialog --> Feedback : Builds the payload
    Popup --> Feedback : Builds the payload
    Popup --> BackgroundScript : Hands over the feedback payload & requests a database update
    FeedbackDialog --> BackgroundScript : Hands over the feedback payload
    BackgroundScript --> Feedback : Builds the request
    BackgroundScript ..> FeedbackServer : Submits user corrections

    OptionsUI *-- Controller : Dispatches settings changes
    OptionsUI *-- Model : Reads stats
    OptionsUI --> Origins : Finds the origins to request
    OptionsUI --> ProviderResolver : Inspects a provider manifest before adding it
    OptionsUI --> ProvidersModule : Adds, removes & refreshes providers
    OptionsUI --> BackgroundScript : Requests a database update
    Config --> OptionsUI : Publishes changed values
```
