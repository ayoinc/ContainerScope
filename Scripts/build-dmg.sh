#!/bin/sh
# Packages build/ContainerScope.app into build/ContainerScope-<version>.dmg:
# drag-to-install layout (app + /Applications link), LZFSE-compressed read-only image.
# Run Scripts/build-app.sh first.
#
# Distribution (all optional; set together for a release):
#   SIGN_IDENTITY    Developer ID Application identity: signs the DMG
#   NOTARY_PROFILE   notarytool keychain profile (local), or
#   NOTARY_KEY_PATH + NOTARY_KEY_ID + NOTARY_ISSUER   App Store Connect API key (CI)
# With notary credentials the DMG is notarized and the ticket stapled, so Gatekeeper opens it offline.
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

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
fi
if [ -n "${NOTARY_PROFILE:-}" ]; then
  set -- --keychain-profile "$NOTARY_PROFILE"
elif [ -n "${NOTARY_KEY_PATH:-}" ]; then
  set -- --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER"
else
  set --
fi
if [ $# -gt 0 ]; then
  [ -n "${SIGN_IDENTITY:-}" ] || { echo "Notarization needs SIGN_IDENTITY" >&2; exit 1; }
  xcrun notarytool submit "$DMG" "$@" --wait --timeout 30m >&2
  xcrun stapler staple -q "$DMG"
  spctl --assess --type open --context context:primary-signature "$DMG" >&2
fi
echo "$DMG"
