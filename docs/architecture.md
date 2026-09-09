# Architecture

This diagram shows the modules of the Klikkikuri Paatti extension and the paths between them. It is maintained
by hand. If you change a module boundary, update it here.

Terms used below:

- **Rahti** is the published correction database (`data.json`). The extension downloads it and reads it
  locally. See [rahti](https://github.com/Klikkikuri/rahti).
- **Suola** is the WebAssembly module that normalizes and hashes URLs. The backend and the extension use the
  same module, so both sides agree on a signature. Its normalization rules live in `suola/rules.yaml`. See
  [suola](https://github.com/Klikkikuri/suola).

The popup and the in-page feedback card do not call the feedback server themselves. Both build the request and
give it to the service worker, which makes the one network call. `src/feedback.js` explains why.

```mermaid
---
title: Architecture v0.0.10
---
classDiagram
    direction TB
    class BrowserStorage {
        +local
        +sync
    }
    class Storage {
        +string ns
        +reload()
        +get(key)
        +store(entries)
        +remove(keys)
    }
    class Model {
        +read
        +write
    }
    class Config {
        +enabled
        +activeEnv
        +siteConfigs
        +environmentConfigs
        +getConfig()
        +onConfigValue(select, callback)
    }
    class Controller {
        +setEnabled(value)
        +setSiteEnabled(value)
        +setEnvironment(value)
        +setClickbaitLevel(value)
        +setModifierEnabled(name, value)
        +setDebugVisualsEnabled(value)
        +setVisualHighlightEnabled(value)
        +setEasterEggProbability(value)
        +setRefreshIntervalMinutes(value)
        +setDevTitleDataUrls(urls)
        +updateStatistics()
        +resetStatistics()
    }
    class RahtiModule {
        +fetchRahtiData(options)
        +fetchRahtiDataWithRetry(options, retryConfig)
        +fetcher (HTTP & 304 resolution)
        +schema (SemVer & keying)
        +sync (Storage & metadata)
    }
    class BackgroundScript {
        +updateDynamicContentScripts()
        +fetchRahtiData()
        +fetchRahtiDataWithRetry()
        +isDatabaseStale()
        +alarms
        +initSuola()
        +hashUrls(urls)
        +submitFeedback(url, init)
        +storeFavicon(domain, url)
    }
    class ContentScript {
        +MutationObserver
        +processSite()
        +convertClickbaits()
        +getConversions()
    }
    class FeedbackDialog {
        +open(entry)
        +buildFeedbackRequest()
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
        +hashUrl(url)
        +initSuola()
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
        +SiteConfigs
        +DevSettings
    }
    class FeedbackServer {
        +submitFeedback()
    }
    class TitleDataServer {
        +data_json
    }

    Storage --> BrowserStorage : Reads/writes namespaced keys
    Model --> BrowserStorage : Reads/writes preferences & stats
    Config --> BrowserStorage : Merges defaults & overrides

    Controller <--> Model : Orchestrates state updates

    BackgroundScript --> Config : Reads enabled origins
    BackgroundScript --> Storage : Stores fetched data
    BackgroundScript --> RahtiModule : Requests database fetches
    RahtiModule ..> TitleDataServer : Fetch updates

    ContentScript --> Storage : Reads cached conversions
    ContentScript --> Modifiers : Applies active transformations
    Modifiers --> Model : Reads modifier toggle preferences
    ContentScript --> BackgroundScript : Requests batch URL hashing
    BackgroundScript --> ContentScript : Tells the active tab to re-convert
    BackgroundScript --> SuolaWasm : Instantiates & runs Go Wasm
    ContentScript --> Controller : Updates active page stats
    ContentScript --> StatsModule : Computes session delta & snapshot
    ContentScript *-- FeedbackDialog : Opens from the converted marker
    Controller --> StatsModule : Merges cumulative stats
    Popup --> StatsModule : Computes gauge values

    Popup *-- Controller : Dispatches user preferences
    Popup *-- Model : Reads stats
    Config --> Popup : Publishes changed values
    Popup --> ContentScript : Port connection (highlights)

    Popup --> BackgroundScript : Hands over the feedback request
    FeedbackDialog --> BackgroundScript : Hands over the feedback request
    BackgroundScript ..> FeedbackServer : Submits user corrections

    OptionsUI *-- Controller : Dispatches settings changes
    OptionsUI *-- Model : Reads stats
    Config --> OptionsUI : Publishes changed values
```
