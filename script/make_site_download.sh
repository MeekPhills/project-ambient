#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p 'require(process.argv[1]).version' "$ROOT_DIR/services/mcp/package.json")}"
RELEASE_DIR="$ROOT_DIR/dist/release/$VERSION"
DESTINATION="$ROOT_DIR/apps/site/public/downloads/Project-Ambient-alpha.zip"
STAGING_DESTINATION=""

usage() {
  cat <<'EOF'
usage: make_site_download.sh [version]

Stage only the manifest-named, notarized canonical archive from the matching
version-scoped release directory. Arbitrary archive paths are not accepted.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || {
  printf 'Site download staging requires a semantic version, received: %s\n' "$VERSION" >&2
  exit 2
}

cleanup() {
  [[ -n "$STAGING_DESTINATION" && -f "$STAGING_DESTINATION" ]] && rm -f "$STAGING_DESTINATION"
}
trap cleanup EXIT

"$ROOT_DIR/script/verify_release_artifacts.sh" --require-publishable "$RELEASE_DIR"
SOURCE_NAME="$(node - "$RELEASE_DIR/release-manifest.json" "$VERSION" <<'NODE'
const fs = require('node:fs');
const [manifestPath, expectedVersion] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const archive = manifest.artifacts?.macosArchive;
if (
  manifest.version !== expectedVersion ||
  typeof archive !== 'string' ||
  archive !== `Project-Ambient-${expectedVersion}.zip` ||
  archive.includes('/') || archive.startsWith('.')
) process.exit(1);
process.stdout.write(archive);
NODE
)" || {
  printf 'Release manifest does not name the expected canonical archive for %s.\n' "$VERSION" >&2
  exit 1
}
SOURCE="$RELEASE_DIR/$SOURCE_NAME"
[[ -f "$SOURCE" ]] || {
  printf 'Notarized canonical release archive is missing: %s\n' "$SOURCE" >&2
  exit 1
}

"$ROOT_DIR/script/verify_release_artifacts.sh" --archive "$SOURCE" --require-notarized
mkdir -p "$(dirname "$DESTINATION")"
STAGING_DESTINATION="$(mktemp "$(dirname "$DESTINATION")/.Project-Ambient-alpha.zip.staging.XXXXXX")"
cp "$SOURCE" "$STAGING_DESTINATION"
cmp -s "$SOURCE" "$STAGING_DESTINATION" || {
  printf 'Copied site download does not match the verified canonical archive.\n' >&2
  exit 1
}
mv -f "$STAGING_DESTINATION" "$DESTINATION"
STAGING_DESTINATION=""
printf 'Site download staged at %s\n' "$DESTINATION"
