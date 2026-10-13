#!/bin/sh
# Builds ContainerScope.app without Xcode: SwiftPM release build + hand-assembled bundle.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CONFIG:-release}"
APP="$ROOT/build/ContainerScope.app"
# Marketing version comes from the VERSION file (bumped by Scripts/release.sh); the build number
# is the commit count, so every pushed commit gets a higher CFBundleVersion.
VERSION="${VERSION:-$(cat "$ROOT/VERSION")}"
BUILD="${BUILD:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}"

cd "$ROOT"
swift build -c "$CONFIG"
BIN="$(swift build -c "$CONFIG" --show-bin-path)/ContainerScope"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/ContainerScope"
cp -R "$ROOT/Sources/ContainerScope/Web" "$APP/Contents/Resources/Web"
cp "$ROOT/Artwork/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp -R "$ROOT/Firmware" "$APP/Contents/Resources/Firmware"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ContainerScope</string>
  <key>CFBundleDisplayName</key><string>ContainerScope</string>
  <key>CFBundleIdentifier</key><string>dev.containerscope.app</string>
  <key>CFBundleExecutable</key><string>ContainerScope</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticTermination</key><false/>
</dict>
</plist>
PLIST

# SIGN_IDENTITY: a Developer ID Application identity (name or SHA-1) for distributable builds,
# signed with the hardened runtime and a secure timestamp as notarization requires.
# Unset: ad-hoc signature for local use.
if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
  codesign --verify --strict --deep "$APP"
else
  codesign --force --sign - "$APP" >/dev/null
fi
echo "$APP"
