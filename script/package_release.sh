#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/apps/macos"
MCP_DIR="$ROOT_DIR/services/mcp"
RELEASE_MODE="candidate"
SOURCE_TAG=""
VERSION=""
RELEASE_PARENT="$ROOT_DIR/dist/release"
APP_BUNDLE="$PACKAGE_DIR/dist/Ambient.app"
STAGE_DIR=""

usage() {
  cat <<'EOF'
usage: package_release.sh [--candidate | --tagged-release <vX.Y.Z>] [version]

Build a version-scoped, unsigned release candidate. The version must match the
MCP package, MCP registry metadata, and MCPB manifest. This command deliberately
does not sign, notarize, publish, or overwrite an existing release directory.

--candidate is the default and requires a clean checkout at an immutable commit.
--tagged-release additionally requires the supplied v<version> tag to resolve to
HEAD. Only tagged-release artifacts are eligible for signing and publication.
EOF
}

fail() {
  printf 'Release packaging failed: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate)
      RELEASE_MODE="candidate"
      shift
      ;;
    --tagged-release)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      RELEASE_MODE="tagged-release"
      SOURCE_TAG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage >&2
      exit 2
      ;;
    *)
      [[ -z "$VERSION" ]] || { usage >&2; exit 2; }
      VERSION="$1"
      shift
      ;;
  esac
done

VERSION="${VERSION:-$(node -p 'require(process.argv[1]).version' "$MCP_DIR/package.json")}"
RELEASE_DIR="${AMBIENT_RELEASE_DIR:-$RELEASE_PARENT/$VERSION}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || \
  fail "invalid semantic version: $VERSION"
[[ ! -e "$RELEASE_DIR" ]] || fail "refusing to overwrite existing release directory: $RELEASE_DIR"
if [[ "$RELEASE_MODE" == "tagged-release" && "$SOURCE_TAG" != "v$VERSION" ]]; then
  fail "tagged releases must use v$VERSION, received: ${SOURCE_TAG:-<missing>}"
fi

homebrew_version="$(sed -nE 's/^  version "([^"]+)"$/\1/p' "$ROOT_DIR/distribution/homebrew/project-ambient.rb")"
if [[ "$homebrew_version" != "$VERSION" ]]; then
  printf 'Release candidate version %s differs from the currently published Homebrew cask version %s.\n' "$VERSION" "$homebrew_version" >&2
  printf 'This is expected while preparing a new candidate; do not update the cask until the canonical archive is notarized.\n' >&2
  printf 'Before publication, run script/verify_homebrew_cask.sh --release-dir %s after updating the cask checksum.\n' "$RELEASE_DIR" >&2
fi

source_status="$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=all)" || \
  fail 'could not inspect the release source checkout'
[[ -z "$source_status" ]] || \
  fail 'release packaging requires a clean checkout with no tracked or untracked changes'
source_revision="$(git -C "$ROOT_DIR" rev-parse --verify 'HEAD^{commit}')" || \
  fail 'could not resolve the release source revision'
if [[ "$RELEASE_MODE" == "tagged-release" ]]; then
  tagged_revision="$(git -C "$ROOT_DIR" rev-parse --verify "refs/tags/$SOURCE_TAG^{commit}")" || \
    fail "release tag does not resolve to a commit: $SOURCE_TAG"
  [[ "$tagged_revision" == "$source_revision" ]] || \
    fail "release tag $SOURCE_TAG does not point to HEAD ($source_revision)"
fi
bundle_short_version="${VERSION%%[-+]*}"
bundle_build_version="${AMBIENT_BUNDLE_BUILD:-1}"

json_version() {
  local file="$1"
  node -p 'require(process.argv[1]).version' "$file"
}

for metadata_file in \
  "$MCP_DIR/package.json" \
  "$MCP_DIR/server.json" \
  "$MCP_DIR/packaging/mcpb/manifest.json"; do
  metadata_version="$(json_version "$metadata_file")" || fail "cannot read version from $metadata_file"
  [[ "$metadata_version" == "$VERSION" ]] || \
    fail "version mismatch: $metadata_file is $metadata_version, expected $VERSION"
done

mkdir -p "$RELEASE_PARENT"
STAGE_DIR="$(mktemp -d "$RELEASE_PARENT/.${VERSION}.staging.XXXXXX")"
cleanup() {
  [[ -n "$STAGE_DIR" && -d "$STAGE_DIR" ]] && rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

BUILD_STAGING="$STAGE_DIR/.build"
ARCHIVE_STAGING="$STAGE_DIR/archive"
UNIVERSAL_DIR="$BUILD_STAGING/universal"
mkdir -p "$BUILD_STAGING" "$ARCHIVE_STAGING" "$UNIVERSAL_DIR"

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

for architecture in arm64 x86_64; do
  target_triple="$architecture-apple-macosx14.0"
  swift build "${SWIFT_FLAGS[@]}" -c release --triple "$target_triple"
  binary_dir="$(swift build "${SWIFT_FLAGS[@]}" -c release --triple "$target_triple" --show-bin-path)"
  cp "$binary_dir/Ambient" "$BUILD_STAGING/Ambient-$architecture"
  cp "$binary_dir/ambientctl" "$BUILD_STAGING/ambientctl-$architecture"
done

lipo -create "$BUILD_STAGING/Ambient-arm64" "$BUILD_STAGING/Ambient-x86_64" -output "$UNIVERSAL_DIR/Ambient"
lipo -create "$BUILD_STAGING/ambientctl-arm64" "$BUILD_STAGING/ambientctl-x86_64" -output "$UNIVERSAL_DIR/ambientctl"

# build_and_run supplies the bundle layout, resources, and executable permissions.
# Replace its host-native binaries with the verified universal release binaries.
AMBIENT_BUNDLE_VERSION="$bundle_short_version" \
AMBIENT_BUNDLE_BUILD="$bundle_build_version" \
  "$ROOT_DIR/script/build_and_run.sh" --stage
cp "$UNIVERSAL_DIR/Ambient" "$APP_BUNDLE/Contents/MacOS/Ambient"
cp "$UNIVERSAL_DIR/ambientctl" "$APP_BUNDLE/Contents/Resources/ambientctl"

mkdir -p "$ARCHIVE_STAGING/Project Ambient"
cp -R "$APP_BUNDLE" "$ARCHIVE_STAGING/Project Ambient/Project Ambient.app"
cp "$UNIVERSAL_DIR/ambientctl" "$ARCHIVE_STAGING/Project Ambient/ambientctl"
for document in README.md LICENSE PRIVACY.md SECURITY.md; do
  cp "$ROOT_DIR/$document" "$ARCHIVE_STAGING/Project Ambient/$document"
done

ditto -c -k --sequesterRsrc --keepParent \
  "$ARCHIVE_STAGING/Project Ambient" \
  "$STAGE_DIR/Project-Ambient-$VERSION.zip"

git -C "$ROOT_DIR" archive --format=zip \
  --output "$STAGE_DIR/Project-Ambient-$VERSION-source.zip" \
  "$source_revision"

npm_config_cache="$STAGE_DIR/.npm-cache" \
  npm --prefix "$MCP_DIR" pack --pack-destination "$STAGE_DIR" >/dev/null
MCP_PACKAGE_PATH="$(find "$STAGE_DIR" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
[[ -n "$MCP_PACKAGE_PATH" ]] || fail 'npm pack did not create an MCP package'
MCP_PACKAGE_NAME="$(basename "$MCP_PACKAGE_PATH")"

MCP_BUNDLE_PATH="$STAGE_DIR/Project-Ambient-Control-$VERSION.mcpb"
"$ROOT_DIR/script/build_mcpb_release.sh" "$MCP_BUNDLE_PATH"

MARKETPLACE_DIR="$ARCHIVE_STAGING/Project Ambient Marketplace Kit"
mkdir -p "$MARKETPLACE_DIR/openai" "$MARKETPLACE_DIR/mcp-registry" "$MARKETPLACE_DIR/anthropic" "$MARKETPLACE_DIR/homebrew"
cp -R "$MCP_DIR/submission/." "$MARKETPLACE_DIR/openai/"
cp "$MCP_DIR/server.json" "$MARKETPLACE_DIR/mcp-registry/server.json"
cp "$MCP_DIR/packaging/mcpb/manifest.json" "$MARKETPLACE_DIR/anthropic/manifest.json"
cp "$ROOT_DIR/distribution/homebrew/project-ambient.rb" "$MARKETPLACE_DIR/homebrew/project-ambient.rb"
cp "$ROOT_DIR/docs/marketplace-runbook.md" "$MARKETPLACE_DIR/README.md"
ditto -c -k --sequesterRsrc --keepParent \
  "$MARKETPLACE_DIR" \
  "$STAGE_DIR/Project-Ambient-Marketplace-Kit-$VERSION.zip"

(
  cd "$ROOT_DIR"
  shasum -a 256 \
    services/mcp/package-lock.json \
    apps/site/package-lock.json \
    script/mcpb-tooling/package-lock.json > "$STAGE_DIR/DEPENDENCY_LOCKS.sha256"
)

node "$ROOT_DIR/script/generate_release_sbom.mjs" \
  --version "$VERSION" \
  --output "$STAGE_DIR/Project-Ambient-$VERSION-sbom.cdx.json" \
  "$MCP_DIR/package-lock.json" \
  "$ROOT_DIR/apps/site/package-lock.json" \
  "$ROOT_DIR/script/mcpb-tooling/package-lock.json"

node - "$STAGE_DIR/release-manifest.json" "$VERSION" "$source_revision" "$bundle_short_version" "$MCP_PACKAGE_NAME" "$RELEASE_MODE" "$SOURCE_TAG" <<'NODE'
const fs = require('node:fs');
const [output, version, revision, bundleShortVersion, mcpPackage, releaseMode, sourceTag] = process.argv.slice(2);
const manifest = {
  schemaVersion: 1,
  version,
  sourceRevision: revision,
  source: {
    mode: releaseMode,
    revision,
    ...(sourceTag ? { tag: sourceTag } : {}),
  },
  bundleShortVersion,
  architectures: ['arm64', 'x86_64'],
  sbom: {
    format: 'CycloneDX 1.5',
    generator: 'script/generate_release_sbom.mjs@1 (Node.js)',
  },
  signing: {
    status: 'unsigned',
    requiredForPublication: true,
    gate: 'AMBIENT_SIGN_IDENTITY and AMBIENT_NOTARY_PROFILE',
  },
  artifacts: {
    macosArchive: `Project-Ambient-${version}.zip`,
    sourceArchive: `Project-Ambient-${version}-source.zip`,
    mcpPackage,
    mcpBundle: `Project-Ambient-Control-${version}.mcpb`,
    marketplaceKit: `Project-Ambient-Marketplace-Kit-${version}.zip`,
  },
};
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

(
  cd "$STAGE_DIR"
  find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -exec basename {} \; \
    | LC_ALL=C sort \
    | while IFS= read -r file; do
        shasum -a 256 "$file"
      done > SHA256SUMS.txt
)

"$ROOT_DIR/script/verify_release_artifacts.sh" "$STAGE_DIR"

rm -rf "$BUILD_STAGING" "$ARCHIVE_STAGING" "$STAGE_DIR/.npm-cache"
mv "$STAGE_DIR" "$RELEASE_DIR"
STAGE_DIR=""

printf 'Unsigned release candidate created in %s\n' "$RELEASE_DIR"
if [[ "$RELEASE_MODE" == "tagged-release" ]]; then
  printf 'Signing and notarization are still required before publication.\n'
else
  printf 'Candidate mode is not eligible for signing or publication; rebuild from the matching release tag.\n'
fi
