#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p 'require(process.argv[1]).version' "$ROOT_DIR/services/mcp/package.json")}"
SOURCE="${2:-$ROOT_DIR/dist/release/$VERSION/Project-Ambient-$VERSION.zip}"
DESTINATION="$ROOT_DIR/apps/site/public/downloads/Project-Ambient-alpha.zip"

if [[ ! -f "$SOURCE" ]]; then
  printf 'Notarized release archive is missing: %s\n' "$SOURCE" >&2
  printf 'Package, sign, notarize, staple, and verify the release before staging a site download.\n' >&2
  exit 1
fi

"$ROOT_DIR/script/verify_release_artifacts.sh" --require-publishable "$(dirname "$SOURCE")"
"$ROOT_DIR/script/verify_release_artifacts.sh" --archive "$SOURCE" --require-notarized
mkdir -p "$(dirname "$DESTINATION")"
cp "$SOURCE" "$DESTINATION"
printf 'Site download staged at %s\n' "$DESTINATION"
