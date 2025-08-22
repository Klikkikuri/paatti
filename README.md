# ⛵ Paatti

Browser extension to sail the web.


## Installing (development)
### Requirements
- Docker (tested on version 28.1.1)
- Access to Klikkikuri GitHub repositories:
    - `suola`

### Configuration
Search for string `CONFIG` from the JavaScript files for various points where configuration values can be edited.

### How to
Fetch and build dependencies by running:
```bash
./build.sh
```

For Firefox enter `about:debugging` to the address bar and from the This Firefox -tab select any file at project root (e.g., `manifest.json`) from Load Temporary Add-on...

## Architecture
```mermaid
---
title: Architecture v0.1
---
classDiagram
    direction TB
    class LocalStore{
    }
    class GlobalData{
        bool enabled
    }
    class PageDashboardData{
        bool enabled
        bool kerran
    }
    class Statistics{
    }
    class Popup{
    }
    class SettingsView{
    }
    class PageDashboardView{
        +toggleAina()
    }
    class FeedbackView{
    }
    class ContentScripts{
    }

    LocalStore *-- GlobalData
    LocalStore *-- PageDashboardData

    PageDashboardData *-- Statistics

    ContentScripts <-- GlobalData
    ContentScripts <-- PageDashboardData
    ContentScripts --> Statistics
    ContentScripts --() Meri : Fetch conversions

    Popup *-- PageDashboardView
    Popup *-- SettingsView
    Popup *-- FeedbackView
    Popup <--> GlobalData

    PageDashboardView <-- Statistics
    PageDashboardView <--> PageDashboardData

    SettingsView <--> PageDashboardData

    FeedbackView <-- PageDashboardData
    FeedbackView --() FeedbackServer : Submit feedback
```
