#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Ambient"
BUNDLE_ID="io.projectambient.mac"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/apps/macos"
DIST_DIR="$PACKAGE_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
BUILD_CACHE="$PACKAGE_DIR/.build/codex-cache"
BUILD_CONFIG="$PACKAGE_DIR/.build/codex-config"
BUILD_SECURITY="$PACKAGE_DIR/.build/codex-security"
MODULE_CACHE="$PACKAGE_DIR/.build/module-cache"

mkdir -p "$BUILD_CACHE" "$BUILD_CONFIG" "$BUILD_SECURITY" "$MODULE_CACHE"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true

cd "$PACKAGE_DIR"
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE"
SWIFT_FLAGS=(
  --disable-sandbox
  --cache-path "$BUILD_CACHE"
  --config-path "$BUILD_CONFIG"
  --security-path "$BUILD_SECURITY"
)

swift build "${SWIFT_FLAGS[@]}"
BUILD_BINARY_DIR="$(swift build "${SWIFT_FLAGS[@]}" --show-bin-path)"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$BUILD_BINARY_DIR/$APP_NAME" "$APP_BINARY"
cp "$BUILD_BINARY_DIR/ambientctl" "$APP_RESOURCES/ambientctl"
cp "$PACKAGE_DIR/Assets/AppIcon.icns" "$APP_RESOURCES/AppIcon.icns"
chmod +x "$APP_BINARY" "$APP_RESOURCES/ambientctl"

/usr/bin/plutil -create xml1 "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleExecutable -string "$APP_NAME" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleIdentifier -string "$BUNDLE_ID" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleName -string "Project Ambient" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleDisplayName -string "Project Ambient" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleIconFile -string "AppIcon" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundlePackageType -string "APPL" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleShortVersionString -string "0.1.0" "$INFO_PLIST"
/usr/bin/plutil -insert CFBundleVersion -string "1" "$INFO_PLIST"
/usr/bin/plutil -insert LSMinimumSystemVersion -string "$MIN_SYSTEM_VERSION" "$INFO_PLIST"
/usr/bin/plutil -insert NSPrincipalClass -string "NSApplication" "$INFO_PLIST"
/usr/bin/plutil -insert NSHighResolutionCapable -bool true "$INFO_PLIST"

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --stage|stage)
    echo "Staged $APP_BUNDLE"
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    echo "Verified $APP_NAME is running from $APP_BUNDLE"
    ;;
  *)
    echo "usage: $0 [run|--stage|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
