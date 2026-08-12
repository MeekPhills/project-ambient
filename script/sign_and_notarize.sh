#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$ARCHIVE" ]]; then
  printf 'usage: AMBIENT_SIGN_IDENTITY=... AMBIENT_NOTARY_PROFILE=... %s <release-zip>\n' "$0" >&2
  exit 2
fi
if [[ -z "${AMBIENT_SIGN_IDENTITY:-}" || -z "${AMBIENT_NOTARY_PROFILE:-}" ]]; then
  printf 'Signing and notarization are intentionally blocked until both AMBIENT_SIGN_IDENTITY and AMBIENT_NOTARY_PROFILE are configured.\n' >&2
  printf 'No unsigned archive has been promoted or published.\n' >&2
  exit 2
fi

if [[ ! -f "$ARCHIVE" ]]; then
  printf 'Archive does not exist: %s\n' "$ARCHIVE" >&2
  exit 1
fi

RELEASE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
MANIFEST="$RELEASE_DIR/release-manifest.json"
SUMS="$RELEASE_DIR/SHA256SUMS.txt"
[[ -f "$MANIFEST" && -f "$SUMS" ]] || {
  printf 'Signing requires a version-scoped release directory with its manifest and checksum record.\n' >&2
  exit 1
}
read -r RELEASE_VERSION SOURCE_TAG SOURCE_REVISION < <(node - "$MANIFEST" "$(basename "$ARCHIVE")" <<'NODE'
const fs = require('node:fs');
const [manifestPath, archiveName] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const valid =
  manifest.source?.mode === 'tagged-release' &&
  typeof manifest.source?.tag === 'string' &&
  typeof manifest.source?.revision === 'string' &&
  manifest.source.tag === `v${manifest.version}` &&
  manifest.signing?.status === 'unsigned' &&
  manifest.signing?.requiredForPublication === true &&
  manifest.artifacts?.macosArchive === archiveName;
if (!valid) process.exit(1);
process.stdout.write(`${manifest.version} ${manifest.source.tag} ${manifest.source.revision}\n`);
NODE
) || {
  printf 'Signing requires an unsigned tagged-release manifest that names this canonical archive.\n' >&2
  exit 1
}
tagged_revision="$(git -C "$ROOT_DIR" rev-parse --verify "refs/tags/$SOURCE_TAG^{commit}")" || {
  printf 'Release source tag is unavailable locally: %s\n' "$SOURCE_TAG" >&2
  exit 1
}
[[ "$tagged_revision" == "$SOURCE_REVISION" ]] || {
  printf 'Release source tag %s does not match manifest revision %s.\n' "$SOURCE_TAG" "$SOURCE_REVISION" >&2
  exit 1
}

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

ditto -x -k "$ARCHIVE" "$WORK_DIR"
RELEASE_CONTENTS="$WORK_DIR/Project Ambient"
APP_PATH="$RELEASE_CONTENTS/Project Ambient.app"

if [[ ! -d "$APP_PATH" || ! -x "$RELEASE_CONTENTS/ambientctl" ]]; then
  printf 'Archive does not contain the expected Project Ambient release layout.\n' >&2
  exit 1
fi

# Sign nested executable code first, then the bundle. Intentionally do not
# preserve the SwiftPM development get-task-allow entitlement.
while IFS= read -r -d '' NESTED_BINARY; do
  codesign --force --options runtime --timestamp \
    --sign "$AMBIENT_SIGN_IDENTITY" "$NESTED_BINARY"
done < <(find "$APP_PATH/Contents" -type f -perm -111 -print0)

codesign --force --options runtime --timestamp \
  --sign "$AMBIENT_SIGN_IDENTITY" "$RELEASE_CONTENTS/ambientctl"
codesign --force --options runtime --timestamp \
  --sign "$AMBIENT_SIGN_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign --verify --strict --verbose=2 "$RELEASE_CONTENTS/ambientctl"
codesign -dvv "$RELEASE_CONTENTS/ambientctl" 2>&1 | grep -Fq 'Authority=Developer ID Application' || {
  printf 'Top-level ambientctl is not signed with a Developer ID Application certificate.\n' >&2
  exit 1
}
if codesign -d --entitlements :- "$APP_PATH" 2>&1 | grep -q 'get-task-allow'; then
  printf 'Distribution bundle still contains get-task-allow. Refusing to notarize.\n' >&2
  exit 1
fi

NOTARY_ARCHIVE="${ARCHIVE%.zip}-notary-submission.zip"
FINAL_STAGING_ARCHIVE="${ARCHIVE%.zip}-notarized.staging.zip"
UNSIGNED_ARCHIVE="${ARCHIVE%.zip}-unsigned.zip"
for output in "$NOTARY_ARCHIVE" "$FINAL_STAGING_ARCHIVE" "$UNSIGNED_ARCHIVE"; do
  if [[ -e "$output" ]]; then
    printf 'Refusing to overwrite an existing signing output: %s\n' "$output" >&2
    exit 1
  fi
done

ditto -c -k --sequesterRsrc --keepParent "$RELEASE_CONTENTS" "$NOTARY_ARCHIVE"
xcrun notarytool submit "$NOTARY_ARCHIVE" --keychain-profile "$AMBIENT_NOTARY_PROFILE" --wait
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"

ditto -c -k --sequesterRsrc --keepParent "$RELEASE_CONTENTS" "$FINAL_STAGING_ARCHIVE"
"$ROOT_DIR/script/verify_release_artifacts.sh" --archive "$FINAL_STAGING_ARCHIVE" --require-notarized

# Preserve the original candidate for auditability, then promote the notarized
# archive to the canonical filename used by the GitHub Release and Homebrew cask.
mv "$ARCHIVE" "$UNSIGNED_ARCHIVE"
mv "$FINAL_STAGING_ARCHIVE" "$ARCHIVE"
rm -f "$NOTARY_ARCHIVE"

if [[ -f "$MANIFEST" && -f "$SUMS" ]]; then
  node - "$MANIFEST" "$(basename "$ARCHIVE")" "$(basename "$UNSIGNED_ARCHIVE")" <<'NODE'
const fs = require('node:fs');
const [manifestPath, archive, unsignedArchive] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.signing = {
  ...manifest.signing,
  status: 'notarized',
  requiredForPublication: false,
};
manifest.artifacts = {
  ...manifest.artifacts,
  macosArchive: archive,
  unsignedMacosArchive: unsignedArchive,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  (
    cd "$RELEASE_DIR"
    find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -exec basename {} \; \
      | LC_ALL=C sort \
      | while IFS= read -r file; do
          shasum -a 256 "$file"
        done > SHA256SUMS.txt
  )
fi

printf 'Signed and notarized archive promoted to: %s\n' "$ARCHIVE"
printf 'Unsigned release candidate retained at: %s\n' "$UNSIGNED_ARCHIVE"
shasum -a 256 "$ARCHIVE"
