#!/usr/bin/env bash
#
# Convert the full-size home view artwork in this directory into the small webp
# derivatives the popup actually loads.
#
# The sources are multi-megabyte masters kept out of the shipped tree; the popup
# renders them at roughly 356 CSS px wide, so a 1400 px webp is still oversampled
# on a 2x display while being some two orders of magnitude smaller.
#
# Every bg-<variant>.(png|jpg|jpeg) here becomes images/bg-<variant>.webp, which
# is what --home-bg in src/options/theme.css points at.
#
# Usage: ./convert.sh [WIDTH] [QUALITY]     (defaults: 1400 78)

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$(cd "${SOURCE_DIR}/../../src/options/images" && pwd)"

WIDTH="${1:-1400}"
QUALITY="${2:-78}"

# ImageMagick 7 ships `magick`; 6 only has `convert`.
if command -v magick >/dev/null 2>&1; then
    CONVERT=(magick)
elif command -v convert >/dev/null 2>&1; then
    CONVERT=(convert)
else
    echo "ImageMagick not found. Install it (apt install imagemagick) and re-run." >&2
    exit 1
fi

shopt -s nullglob nocaseglob
sources=("${SOURCE_DIR}"/bg-*.png "${SOURCE_DIR}"/bg-*.jpg "${SOURCE_DIR}"/bg-*.jpeg)
shopt -u nocaseglob

if [ ${#sources[@]} -eq 0 ]; then
    echo "No bg-*.png/jpg sources in ${SOURCE_DIR}." >&2
    exit 1
fi

for source in "${sources[@]}"; do
    name="$(basename "${source}")"
    target="${OUTPUT_DIR}/${name%.*}.webp"

    # -strip drops the EXIF/colour profile baggage; nothing in the popup reads it.
    "${CONVERT[@]}" "${source}" -resize "${WIDTH}x" -strip -quality "${QUALITY}" "${target}"

    printf '%s -> %s (%s KB)\n' \
        "${name}" "${target#"${OUTPUT_DIR}/"}" "$(( ($(wc -c <"${target}") + 1023) / 1024 ))"
done
