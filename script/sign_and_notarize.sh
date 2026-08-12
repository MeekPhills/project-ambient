#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:-}"
: "${ARCHIVE:?usage: AMBIENT_SIGN_IDENTITY=... AMBIENT_NOTARY_PROFILE=... $0 <release-zip>}"
: "${AMBIENT_SIGN_IDENTITY:?Set AMBIENT_SIGN_IDENTITY to a Developer ID Application identity}"
: "${AMBIENT_NOTARY_PROFILE:?Set AMBIENT_NOTARY_PROFILE to an xcrun notarytool keychain profile}"

if [[ ! -f "$ARCHIVE" ]]; then
  printf 'Archive does not exist: %s\n' "$ARCHIVE" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

ditto -x -k "$ARCHIVE" "$WORK_DIR"
APP_PATH="$(find "$WORK_DIR" -type d -name '*.app' -maxdepth 3 -print -quit)"

if [[ -z "$APP_PATH" ]]; then
  printf 'No .app bundle found in archive.\n' >&2
  exit 1
fi

# Sign nested executable code first, then the bundle. Intentionally do not
# preserve the SwiftPM development get-task-allow entitlement.
while IFS= read -r -d '' NESTED_BINARY; do
  codesign --force --options runtime --timestamp \
    --sign "$AMBIENT_SIGN_IDENTITY" "$NESTED_BINARY"
done < <(find "$APP_PATH/Contents" -type f -perm -111 -print0)

codesign --force --options runtime --timestamp \
  --sign "$AMBIENT_SIGN_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
if codesign -d --entitlements :- "$APP_PATH" 2>&1 | grep -q 'get-task-allow'; then
  printf 'Distribution bundle still contains get-task-allow. Refusing to notarize.\n' >&2
  exit 1
fi

SIGNED_ARCHIVE="${ARCHIVE%.zip}-signed.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$SIGNED_ARCHIVE"
xcrun notarytool submit "$SIGNED_ARCHIVE" --keychain-profile "$AMBIENT_NOTARY_PROFILE" --wait
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"

FINAL_ARCHIVE="${ARCHIVE%.zip}-notarized.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$FINAL_ARCHIVE"
shasum -a 256 "$FINAL_ARCHIVE"
printf 'Signed and notarized archive: %s\n' "$FINAL_ARCHIVE"
