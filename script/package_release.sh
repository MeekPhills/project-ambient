#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.1.0-alpha}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/dist/release"
STAGE_DIR="$RELEASE_DIR/stage"
APP_BUNDLE="$ROOT_DIR/apps/macos/dist/Ambient.app"
PACKAGE_DIR="$ROOT_DIR/apps/macos"
mkdir -p "$PACKAGE_DIR/.build/codex-cache" "$PACKAGE_DIR/.build/codex-config" "$PACKAGE_DIR/.build/codex-security" "$PACKAGE_DIR/.build/module-cache"
export CLANG_MODULE_CACHE_PATH="$PACKAGE_DIR/.build/module-cache"
SWIFT_FLAGS=(
  --package-path "$PACKAGE_DIR"
  --disable-sandbox
  --cache-path "$PACKAGE_DIR/.build/codex-cache"
  --config-path "$PACKAGE_DIR/.build/codex-config"
  --security-path "$PACKAGE_DIR/.build/codex-security"
)

"$ROOT_DIR/script/verify_release.sh"
swift build "${SWIFT_FLAGS[@]}" -c release
MAC_BIN_DIR="$(swift build "${SWIFT_FLAGS[@]}" -c release --show-bin-path)"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/Project Ambient" "$RELEASE_DIR"

# Build a foreground application bundle using the project run entrypoint, then
# replace its executable with the optimized release binary.
"$ROOT_DIR/script/build_and_run.sh" --stage
cp "$MAC_BIN_DIR/Ambient" "$APP_BUNDLE/Contents/MacOS/Ambient"
cp "$MAC_BIN_DIR/ambientctl" "$APP_BUNDLE/Contents/Resources/ambientctl"
cp -R "$APP_BUNDLE" "$STAGE_DIR/Project Ambient/Project Ambient.app"
cp "$MAC_BIN_DIR/ambientctl" "$STAGE_DIR/Project Ambient/ambientctl"
cp "$ROOT_DIR/README.md" "$STAGE_DIR/Project Ambient/README.md"
cp "$ROOT_DIR/LICENSE" "$STAGE_DIR/Project Ambient/LICENSE"
cp "$ROOT_DIR/PRIVACY.md" "$STAGE_DIR/Project Ambient/PRIVACY.md"
cp "$ROOT_DIR/SECURITY.md" "$STAGE_DIR/Project Ambient/SECURITY.md"

ditto -c -k --sequesterRsrc --keepParent \
  "$STAGE_DIR/Project Ambient" \
  "$RELEASE_DIR/Project-Ambient-$VERSION.zip"

git -C "$ROOT_DIR" archive --format=zip \
  --output "$RELEASE_DIR/Project-Ambient-$VERSION-source.zip" HEAD

(cd "$ROOT_DIR/services/mcp" && npm_config_cache="$ROOT_DIR/services/mcp/.npm-cache" npm pack --pack-destination "$RELEASE_DIR")

cp "$ROOT_DIR/services/mcp/project-ambient-control.mcpb" \
  "$RELEASE_DIR/Project-Ambient-Control-$VERSION.mcpb"

MARKETPLACE_DIR="$STAGE_DIR/Project Ambient Marketplace Kit"
mkdir -p "$MARKETPLACE_DIR/openai" "$MARKETPLACE_DIR/mcp-registry" "$MARKETPLACE_DIR/anthropic" "$MARKETPLACE_DIR/homebrew"
cp -R "$ROOT_DIR/services/mcp/submission/." "$MARKETPLACE_DIR/openai/"
cp "$ROOT_DIR/services/mcp/server.json" "$MARKETPLACE_DIR/mcp-registry/server.json"
cp "$ROOT_DIR/services/mcp/packaging/mcpb/manifest.json" "$MARKETPLACE_DIR/anthropic/manifest.json"
cp "$ROOT_DIR/distribution/homebrew/project-ambient.rb" "$MARKETPLACE_DIR/homebrew/project-ambient.rb"
cp "$ROOT_DIR/docs/marketplace-runbook.md" "$MARKETPLACE_DIR/README.md"
ditto -c -k --sequesterRsrc --keepParent \
  "$MARKETPLACE_DIR" \
  "$RELEASE_DIR/Project-Ambient-Marketplace-Kit-$VERSION.zip"

if command -v syft >/dev/null 2>&1; then
  syft dir:"$ROOT_DIR" -o cyclonedx-json="$RELEASE_DIR/Project-Ambient-$VERSION-sbom.cdx.json"
else
  npm --prefix "$ROOT_DIR/services/mcp" ls --all --json > "$RELEASE_DIR/Project-Ambient-$VERSION-node-dependencies.json" || true
  swift package "${SWIFT_FLAGS[@]}" show-dependencies --format json > "$RELEASE_DIR/Project-Ambient-$VERSION-swift-dependencies.json"
fi

(
  cd "$RELEASE_DIR"
  find . -maxdepth 1 -type f \( \
    -name '*.zip' -o -name '*.tgz' -o -name '*.mcpb' -o -name '*dependencies.json' \
  \) -print | LC_ALL=C sort | while IFS= read -r FILE; do
    shasum -a 256 "$FILE"
  done > SHA256SUMS.txt
)

printf 'Release package created in %s\n' "$RELEASE_DIR"
