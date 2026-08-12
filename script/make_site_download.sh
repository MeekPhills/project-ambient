#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-0.1.0-alpha}"
SOURCE="$ROOT_DIR/dist/release/Project-Ambient-$VERSION.zip"
DESTINATION="$ROOT_DIR/apps/site/public/downloads/Project-Ambient-alpha.zip"

if [[ ! -f "$SOURCE" ]]; then
  "$ROOT_DIR/script/package_release.sh" "$VERSION"
fi

mkdir -p "$(dirname "$DESTINATION")"
cp "$SOURCE" "$DESTINATION"
printf 'Site download staged at %s\n' "$DESTINATION"
