#!/usr/bin/env bash
set -eo pipefail

# web-ext discovers web-ext-config.cjs in the current working directory and defaults --source-dir to it, so the
# script has to run from the repository root no matter where it was invoked from.
cd "$(dirname "${BASH_SOURCE[0]}")"

# Prefer the web-ext installed in the image (see .devcontainer/Dockerfile); npx is the fallback elsewhere.
if command -v web-ext >/dev/null 2>&1; then
    CMD=(web-ext)
else
    CMD=(npx web-ext)
fi

TARGET="firefox-default"
ARGS=(-s build/dist)
THEME_ARGS=()
START_URL="http://yle.fi/uutiset"
LOG_FILE="build/run.log"

mkdir -p "$(dirname "$LOG_FILE")"

make dist

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ff)
            TARGET="firefox-dev"
            shift
            ;;
        --cr)
            TARGET="chromium"
            shift
            ;;
        --light)
            THEME_ARGS=(
                --pref layout.css.prefers-color-scheme.content-override=1
                --pref ui.systemUsesDarkTheme=0
                --pref extensions.activeThemeID=firefox-compact-light@mozilla.org
            )
            shift
            ;;
        --dark)
            THEME_ARGS=(
                --pref layout.css.prefers-color-scheme.content-override=0
                --pref ui.systemUsesDarkTheme=1
                --pref extensions.activeThemeID=firefox-compact-dark@mozilla.org
            )
            shift
            ;;
        --url|-u|--start-url)
            START_URL="$2"
            shift 2
            ;;
        *)
            ARGS+=("$1")
            shift
            ;;
    esac
done

# Default arguments for Firefox based on your previous command
FIREFOX_ARGS=(
    --pref devtools.console.stdout.chrome=true
    --pref devtools.console.stdout.content=true
    --browser-console
    --verbose
)

# Append theme arguments to firefox args if set
if [[ ${#THEME_ARGS[@]} -gt 0 ]]; then
    FIREFOX_ARGS+=("${THEME_ARGS[@]}")
fi

case "$TARGET" in
    firefox-dev|firefox-default)
        if [[ "$TARGET" == "firefox-dev" ]]; then
            FF_BINS=(firefox-devedition firefox-developer-edition)
        else
            # Prioritize developer edition by default, fallback to standard firefox
            FF_BINS=(firefox-devedition firefox firefox-developer-edition firefox-bin)
        fi

        # Find Firefox binary path
        for bin in "${FF_BINS[@]}"; do
            if FF_BIN_PATH=$(command -v "$bin" 2>/dev/null); then
                FIREFOX_ARGS+=(--firefox "$FF_BIN_PATH")
                break
            fi
        done

        "${CMD[@]}" run -t firefox-desktop --url "$START_URL" "${FIREFOX_ARGS[@]}" "${ARGS[@]}" 2>&1 | tee "$LOG_FILE" 2>&1
        ;;
    chromium)
        CHROMIUM_ARGS=()
        # Find Chromium binary path (some distros ship with a wrapper, requiring explicit path for web-ext)
        for bin in chromium chromium-browser google-chrome-stable google-chrome; do
            if CHROMIUM_BIN=$(command -v "$bin" 2>/dev/null); then
                CHROMIUM_ARGS+=(--chromium-binary "$CHROMIUM_BIN")
                break
            fi
        done
        "${CMD[@]}" run -t chromium --url "$START_URL" "${CHROMIUM_ARGS[@]}" "${ARGS[@]}" 2>&1 | tee "$LOG_FILE" 2>&1
        ;;
esac
