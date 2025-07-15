
## Architecture
```mermaid
---
title: Architecture v0.1
---
classDiagram
    direction BT
    class LocalStore{
    }
    class GlobalData{
        bool enabled
    }
    class NewsSiteData{
        bool enabled
        bool kerran
    }
    class Statistics{
    }
    class Popup{
    }
    class SettingsView{
    }
    class NewsSiteView{
        +toggleAina()
    }
    class FeedbackView{
    }
    class ContentScripts{
    }

    LocalStore *-- GlobalData
    LocalStore *-- NewsSiteData

    NewsSiteData *-- Statistics

    ContentScripts <-- GlobalData
    ContentScripts --> Statistics
    ContentScripts --() Meri : Fetch conversions

    Popup *-- NewsSiteView
    Popup *-- SettingsView
    Popup *-- FeedbackView
    Popup <--> GlobalData

    NewsSiteView <-- Statistics
    NewsSiteView <--> NewsSiteData

    SettingsView <--> NewsSiteData

    FeedbackView <-- NewsSiteData
    FeedbackView --() FeedbackServer : Submit feedback
```

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
