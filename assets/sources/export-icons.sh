#!/usr/bin/env bash
#
# Render the PNG icons manifest.json lists into icons/ from the SVG masters here:
# klikkikuri-reduced.svg for the toolbar sizes (16 to 32), klikkikuri.svg for 48
# to 96, and logo.svg for the 128 store icon and its 256 double. One file per
# size; icons and action.default_icon share them.
#
# The Chrome Web Store wants the 128 icon drawn inside a 96x96 area with 16 px
# of transparent padding per side, so the logo is rendered at 3/4 of the canvas
# and centred; 256 keeps the same proportions.
#
# Usage: ./export-icons.sh

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON_DIR="$(cd "${SOURCE_DIR}/../../icons" && pwd)"

FULL="${SOURCE_DIR}/klikkikuri.svg"
REDUCED="${SOURCE_DIR}/klikkikuri-reduced.svg"
LOGO="${SOURCE_DIR}/logo.svg"
REDUCED_MAX=32
STORE_PADDING_RATIO=8  # 1/8 of the canvas per side: 16 px at 128

for tool in rsvg-convert magick; do
    command -v "${tool}" >/dev/null 2>&1 || {
        echo "${tool} not found. Install librsvg2-bin and imagemagick and re-run." >&2
        exit 1
    }
done

report() { printf '%-24s -> %s (%s B)\n' "$(basename "$1")" "$(basename "$2")" "$(wc -c <"$2")"; }

for size in 16 24 32 48 64 96; do
    if [ "${size}" -le "${REDUCED_MAX}" ]; then master="${REDUCED}"; else master="${FULL}"; fi
    target="${ICON_DIR}/klikkikuri-${size}.png"
    rsvg-convert -w "${size}" -h "${size}" "${master}" -o "${target}"
    report "${master}" "${target}"
done

for size in 128 256; do
    inner=$((size - 2 * size / STORE_PADDING_RATIO))
    target="${ICON_DIR}/klikkikuri-${size}.png"
    rsvg-convert -w "${inner}" -h "${inner}" "${LOGO}" -o "${target}"
    magick "${target}" -background none -gravity center -extent "${size}x${size}" "${target}"
    report "${LOGO}" "${target}"
done
