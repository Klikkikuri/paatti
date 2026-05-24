# ⛵ Paatti

Sail smoothly through the clickbait-infested web using this browser extension.

## Installing

### Building
Requirements
- `make`
- `bash`
- Python 3
- Docker (tested on version 28.1.1) or `podman` (tested on version 5.4.2)
- Access to Klikkikuri GitHub repositories:
    - `suola`

Fetch and build dependencies and package for distribution with `make`.

### Configuration
Search for string `CONFIG` from the JavaScript files for various points where configuration values can be edited (yes really, edit the source code and then re-package).

## How do I get it on my browser

### For Firefox

Enter `about:debugging` to the address bar and from the This Firefox -tab select any file at project root (e.g., `manifest.json`) from Load Temporary Add-on...

#### web-ext run

Alternatively, you can use [`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/) to run the extension:
```sh
web-ext run --devtools [--firefox firefox-devedition] [--url http://www.yle.fi/uutiset]
```

## Development

### Test data
Start the local HTTP server to serve test data:
```sh
python3 httpserver.py
```

### Visual Studio Code debugging
You can also use Visual Studio Code to debug the extension. See the `.vscode/launch.json` for configuration.

## Architecture
```mermaid
---
title: Architecture v0.2
---
classDiagram
    direction TB
    class LocalStore{
    }
    class Config{
        bool enabled
    }
    class Statistics{
    }
    class Popup{
    }
    class SettingsView{
    }
    class MainContentView{
    }
    class FeedbackView{
    }
    class ContentScripts{
    }

    LocalStore *-- Config

    Config *-- Statistics

    ContentScripts <-- Config
    ContentScripts --> Statistics
    ContentScripts --() Meri : Fetch conversions

    Popup *-- MainContentView
    Popup *-- SettingsView
    Popup *-- FeedbackView

    MainContentView <-- Statistics
    MainContentView <--> Config

    SettingsView <--> Config

    FeedbackView --() FeedbackServer : Submit feedback
```
