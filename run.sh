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

usage() {
    cat <<'USAGE'
Usage: ./run.sh [options] [-- web-ext options]

Builds the extension and launches it in a browser via web-ext.

Options:
  --ff                  Use Firefox Developer Edition
  --cr                  Use Chromium instead of Firefox
  --light               Force light theme
  --dark                Force dark theme
  -s, --source-dir DIR  Run this directory as-is instead of building build/dist
  -u, --url URL         Page to open on startup (default: http://yle.fi/uutiset)
  -h, --help            Show this help

Unrecognised arguments are passed through to web-ext run.
USAGE
}

TARGET="firefox-default"
SOURCE_DIR=""
ARGS=()
THEME_ARGS=()
START_URL="http://yle.fi/uutiset"
LOG_FILE="build/run.log"

mkdir -p "$(dirname "$LOG_FILE")"

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
        -h|--help)
            usage
            exit 0
            ;;
        -s|--source-dir)
            SOURCE_DIR="$2"
            shift 2
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

# An explicit -s is run as-is; otherwise build the packed extension and run that.
if [[ -z "$SOURCE_DIR" ]]; then
    SOURCE_DIR="build/dist"
    make dist
fi

ARGS=(-s "$SOURCE_DIR" "${ARGS[@]}")

# Default arguments for Firefox based on your previous command
FIREFOX_ARGS=(
    --pref devtools.console.stdout.chrome=true
    --pref devtools.console.stdout.content=true
    --pref browser.translations.automaticallyPopup=false
    --pref browser.aboutwelcome.enabled=false
    --pref datareporting.policy.dataSubmissionEnabled=false
    --pref datareporting.policy.dataSubmissionPolicyAcceptedVersion=2
    --pref datareporting.policy.dataSubmissionPolicyBypassNotification=true
    --pref startup.homepage_welcome_url=about:blank
    --pref startup.homepage_override_url=about:blank
    --pref browser.startup.homepage_override.mstone=ignore
    --pref trailhead.firstrun.didSeeAboutWelcome=true
    --pref trailhead.firstrun.branches=nofirstrun-empty
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
