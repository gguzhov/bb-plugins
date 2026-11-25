#!/bin/bash
# Builds BBTouchbar.app with swiftc (universal when possible), ad-hoc signed.
# Output: native/build, or the folder in BB_TOUCHBAR_BUILD_DIR (install.sh sets it when the
# plugin folder is read-only, as in a copy installed from the bb catalog). Sources are only read.
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="BBTouchbar"
BUNDLE_ID="app.gguzhov.bb-touchbar"
VERSION="0.2.0"
MIN_OS="13.0"
BUILD="${BB_TOUCHBAR_BUILD_DIR:-build}"
APP="$BUILD/$APP_NAME.app"

mkdir -p "$BUILD"
rm -rf "$APP" "$BUILD"/bin-*
SDK="$(xcrun --sdk macosx --show-sdk-path)"

compile() {
  local arch="$1"
  xcrun swiftc -O -swift-version 5 -sdk "$SDK" -target "$arch-apple-macos$MIN_OS" \
    -framework AppKit -framework SwiftUI \
    -o "$BUILD/bin-$arch" Sources/*.swift
}

echo "building arm64…"
compile arm64
BINARIES=("$BUILD/bin-arm64")
echo "building x86_64…"
if compile x86_64 2>"$BUILD/x86_64.log"; then
  BINARIES+=("$BUILD/bin-x86_64")
else
  echo "x86_64 did not build, arm64 only (see $BUILD/x86_64.log)"
fi

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
if [ "${#BINARIES[@]}" -gt 1 ]; then
  lipo -create "${BINARIES[@]}" -output "$APP/Contents/MacOS/$APP_NAME"
else
  cp "${BINARIES[0]}" "$APP/Contents/MacOS/$APP_NAME"
fi
rm -f "$BUILD"/bin-*

# Mascot pictures (idle.png, left.png, …) go to Resources/mascot; without them the app draws the robot.
shopt -s nullglob
MASCOT=(Assets/mascot/*.png)
if [ "${#MASCOT[@]}" -gt 0 ]; then
  mkdir -p "$APP/Contents/Resources/mascot"
  cp "${MASCOT[@]}" "$APP/Contents/Resources/mascot/"
  echo "mascot: ${#MASCOT[@]} pictures in the app resources"
else
  echo "mascot: no pictures in Assets/mascot (the app uses ~/Library/Application Support/bb-touchbar/mascot or draws the robot)"
fi
shopt -u nullglob

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>Notch Bar</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleDevelopmentRegion</key><string>ru</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_OS</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

codesign --force --sign - --identifier "$BUNDLE_ID" "$APP"
codesign --verify --strict "$APP"
case "$APP" in /*) APP_ABS="$APP" ;; *) APP_ABS="$(pwd)/$APP" ;; esac
echo "built: $APP_ABS ($(lipo -archs "$APP/Contents/MacOS/$APP_NAME"))"
