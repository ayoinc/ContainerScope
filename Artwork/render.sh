#!/bin/sh
# Renders the SVG sources into the committed assets:
#   AppIcon.icns  (bundled by Scripts/build-app.sh)
#   ../Firmware/Logo.png (UEFI boot logo; Firmware/build-aavmf.sh converts it to Logo.bmp)
# Requires: resvg (brew install resvg), iconutil (Xcode Command Line Tools).
set -eu

cd "$(dirname "$0")"
render() { resvg --resources-dir . --use-fonts-dir /System/Library/Fonts --font-family "Helvetica Neue" "$@"; }

render splash.svg ../Firmware/Logo.png

ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  render icon.svg --width "$size" "$ICONSET/icon_${size}x${size}.png"
  render icon.svg --width "$((size * 2))" "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$ICONSET" -o AppIcon.icns
rm -rf "$(dirname "$ICONSET")"
echo "Rendered AppIcon.icns hero.png splash.png"
