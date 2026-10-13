#!/bin/sh
# Packages build/ContainerScope.app into build/ContainerScope-<version>.dmg:
# drag-to-install layout (app + /Applications link), LZFSE-compressed read-only image.
# Run Scripts/build-app.sh first.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/ContainerScope.app"
[ -d "$APP" ] || { echo "Missing $APP; run Scripts/build-app.sh first" >&2; exit 1; }
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
DMG="$ROOT/build/ContainerScope-$VERSION.dmg"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -quiet -volname "ContainerScope $VERSION" -srcfolder "$STAGE" -fs HFS+ -format ULFO "$DMG"
hdiutil verify -quiet "$DMG"
echo "$DMG"
