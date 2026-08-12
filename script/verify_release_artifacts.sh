#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR=""
ARCHIVE=""
REQUIRE_NOTARIZED=false
REQUIRE_PUBLISHABLE=false
REQUIRE_HOMEBREW=false

usage() {
  cat <<'EOF'
usage: verify_release_artifacts.sh [options] <release-directory>
       verify_release_artifacts.sh --archive <macos-archive.zip> [--require-notarized]

Options:
  --archive <path>       Verify one macOS archive instead of a release directory.
  --require-notarized    Require Developer ID signing, a stapled notarization ticket,
                         and Gatekeeper acceptance. This never obtains credentials.
  --require-publishable  Require a notarized artifact from the immutable matching tag.
  --require-homebrew     Require a notarized, tagged release and a Homebrew cask
                         whose version and digest match its promoted archive.
EOF
}

fail() {
  printf 'Release artifact verification failed: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      ARCHIVE="$2"
      shift 2
      ;;
    --require-notarized)
      REQUIRE_NOTARIZED=true
      shift
      ;;
    --require-publishable)
      REQUIRE_PUBLISHABLE=true
      shift
      ;;
    --require-homebrew)
      REQUIRE_HOMEBREW=true
      shift
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
      [[ -z "$RELEASE_DIR" ]] || { usage >&2; exit 2; }
      RELEASE_DIR="$1"
      shift
      ;;
  esac
done

if [[ -n "$ARCHIVE" && -n "$RELEASE_DIR" ]]; then
  fail 'choose either --archive or a release directory'
fi
if [[ -z "$ARCHIVE" && -z "$RELEASE_DIR" ]]; then
  usage >&2
  exit 2
fi
if [[ ( "$REQUIRE_HOMEBREW" == true || "$REQUIRE_PUBLISHABLE" == true ) && -z "$RELEASE_DIR" ]]; then
  fail '--require-publishable and --require-homebrew need a release directory'
fi
if [[ "$REQUIRE_HOMEBREW" == true ]]; then
  REQUIRE_PUBLISHABLE=true
fi
if [[ "$REQUIRE_PUBLISHABLE" == true ]]; then
  REQUIRE_NOTARIZED=true
fi

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "required tool is unavailable: $1"
}

for tool in ditto lipo plutil shasum unzip node tar; do
  require_tool "$tool"
done

validate_archive_entries() {
  local archive="$1"
  local entries
  entries="$(unzip -Z1 "$archive")" || fail "cannot read ZIP archive: $archive"
  if printf '%s\n' "$entries" | grep -En '(^/)|(^|/)\.\.(/|$)' >/dev/null; then
    fail "archive contains an unsafe path: $archive"
  fi
  printf '%s\n' "$entries" | grep -Fx 'Project Ambient/Project Ambient.app/Contents/Info.plist' >/dev/null || \
    fail "archive does not contain the expected application bundle: $archive"
}

assert_universal() {
  local binary="$1"
  local architectures
  architectures="$(lipo -archs "$binary" 2>/dev/null)" || fail "not a Mach-O binary: $binary"
  for architecture in arm64 x86_64; do
    if ! printf '%s\n' "$architectures" | tr ' ' '\n' | grep -Fx "$architecture" >/dev/null; then
      fail "missing $architecture slice in $binary (found: $architectures)"
    fi
  done
}

verify_macos_archive() {
  local archive="$1"
  local expected_version="${2:-}"
  local work_dir app_path info_plist bundle_version top_level_cli

  [[ -f "$archive" ]] || fail "archive does not exist: $archive"
  validate_archive_entries "$archive"

  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' RETURN
  ditto -x -k "$archive" "$work_dir" || fail "cannot expand archive: $archive"
  app_path="$work_dir/Project Ambient/Project Ambient.app"
  top_level_cli="$work_dir/Project Ambient/ambientctl"
  info_plist="$app_path/Contents/Info.plist"
  [[ -f "$info_plist" ]] || fail "expanded archive is missing Info.plist"
  [[ -x "$app_path/Contents/MacOS/Ambient" ]] || fail 'expanded archive is missing Ambient executable'
  [[ -x "$app_path/Contents/Resources/ambientctl" ]] || fail 'expanded archive is missing bundled ambientctl'
  [[ -x "$top_level_cli" ]] || fail 'expanded archive is missing top-level ambientctl'

  assert_universal "$app_path/Contents/MacOS/Ambient"
  assert_universal "$app_path/Contents/Resources/ambientctl"
  assert_universal "$top_level_cli"

  bundle_version="$(plutil -extract CFBundleShortVersionString raw "$info_plist" 2>/dev/null)" || \
    fail 'Info.plist has no CFBundleShortVersionString'
  [[ "$bundle_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
    fail "invalid bundle short version: $bundle_version"
  if [[ -n "$expected_version" ]]; then
    local expected_core_version="${expected_version%%[-+]*}"
    [[ "$bundle_version" == "$expected_core_version" ]] || \
      fail "bundle version $bundle_version does not match release core version $expected_core_version"
  fi

  if [[ "$REQUIRE_NOTARIZED" == true ]]; then
    require_tool codesign
    require_tool xcrun
    require_tool spctl
    codesign --verify --deep --strict --verbose=2 "$app_path" || fail 'codesign verification failed'
    codesign -dvv "$app_path" 2>&1 | grep -F 'Authority=Developer ID Application' >/dev/null || \
      fail 'application is not signed with a Developer ID Application certificate'
    codesign --verify --strict --verbose=2 "$top_level_cli" || \
      fail 'top-level ambientctl codesign verification failed'
    codesign -dvv "$top_level_cli" 2>&1 | grep -F 'Authority=Developer ID Application' >/dev/null || \
      fail 'top-level ambientctl is not signed with a Developer ID Application certificate'
    xcrun stapler validate "$app_path" || fail 'notarization ticket is not stapled to the application'
    spctl --assess --type execute --verbose=4 "$app_path" || fail 'Gatekeeper rejected the application'
  fi

  trap - RETURN
  rm -rf "$work_dir"
}

manifest_value() {
  local key="$1"
  node - "$MANIFEST" "$key" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const value = process.argv[3].split('.').reduce((current, part) => current?.[part], manifest);
if (typeof value !== 'string') process.exit(2);
process.stdout.write(value);
NODE
}

require_publishable_release_manifest() {
  local mode tag revision signing_status signing_required tag_revision
  mode="$(manifest_value source.mode)" || fail 'release manifest has no source mode'
  tag="$(manifest_value source.tag)" || fail 'release manifest has no source tag'
  revision="$(manifest_value source.revision)" || fail 'release manifest has no source revision'
  signing_status="$(manifest_value signing.status)" || fail 'release manifest has no signing status'
  [[ "$mode" == "tagged-release" ]] || fail "Homebrew publication requires tagged-release mode, found: $mode"
  [[ "$tag" == "v$VERSION" ]] || fail "release source tag $tag does not match version v$VERSION"
  [[ "$signing_status" == "notarized" ]] || fail "Homebrew publication requires notarized signing status, found: $signing_status"
  signing_required="$(node - "$MANIFEST" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(manifest.signing?.requiredForPublication));
NODE
  )" || fail 'cannot read release signing requirement'
  [[ "$signing_required" == "false" ]] || fail 'release manifest still requires signing before publication'
  tag_revision="$(git -C "$ROOT_DIR" rev-parse --verify "refs/tags/$tag^{commit}")" || \
    fail "release source tag is unavailable locally: $tag"
  [[ "$tag_revision" == "$revision" ]] || \
    fail "release source revision does not match immutable tag $tag"
}

if [[ -n "$ARCHIVE" ]]; then
  verify_macos_archive "$ARCHIVE"
  printf 'macOS archive verification passed: %s\n' "$ARCHIVE"
  exit 0
fi

[[ -d "$RELEASE_DIR" ]] || fail "release directory does not exist: $RELEASE_DIR"
RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
MANIFEST="$RELEASE_DIR/release-manifest.json"
SUMS="$RELEASE_DIR/SHA256SUMS.txt"
DEPENDENCY_LOCKS="$RELEASE_DIR/DEPENDENCY_LOCKS.sha256"
[[ -f "$MANIFEST" ]] || fail 'release-manifest.json is missing'
[[ -f "$SUMS" ]] || fail 'SHA256SUMS.txt is missing'
[[ -f "$DEPENDENCY_LOCKS" ]] || fail 'DEPENDENCY_LOCKS.sha256 is missing'

if find "$RELEASE_DIR" -maxdepth 1 -type l -print -quit | grep -q .; then
  fail 'release directory contains a symbolic link'
fi

VERSION="$(manifest_value version)" || fail 'release manifest has no version'
MACOS_ARCHIVE="$(manifest_value artifacts.macosArchive)" || fail 'release manifest has no macos archive'
SOURCE_ARCHIVE="$(manifest_value artifacts.sourceArchive)" || fail 'release manifest has no source archive'
MCP_PACKAGE="$(manifest_value artifacts.mcpPackage)" || fail 'release manifest has no MCP package'
MCP_BUNDLE="$(manifest_value artifacts.mcpBundle)" || fail 'release manifest has no MCP bundle'
MARKETPLACE_KIT="$(manifest_value artifacts.marketplaceKit)" || fail 'release manifest has no marketplace kit'

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || \
  fail "invalid release version: $VERSION"
if [[ "$REQUIRE_PUBLISHABLE" == true ]]; then
  require_publishable_release_manifest
fi
for filename in "$MACOS_ARCHIVE" "$SOURCE_ARCHIVE" "$MCP_PACKAGE" "$MCP_BUNDLE" "$MARKETPLACE_KIT"; do
  [[ "$filename" != */* && "$filename" != .* && -f "$RELEASE_DIR/$filename" ]] || \
    fail "manifest references a missing or unsafe artifact: $filename"
done

while IFS=' ' read -r digest filename extra; do
  [[ -n "$digest" && -n "$filename" && -z "$extra" ]] || fail 'checksum file has an invalid line'
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || fail "checksum file has an invalid digest: $digest"
  [[ "$filename" != */* && "$filename" != .* ]] || fail "checksum file has an unsafe filename: $filename"
done < "$SUMS"

(
  cd "$RELEASE_DIR"
  shasum -a 256 -c SHA256SUMS.txt
) || fail 'one or more artifact checksums do not match'

while IFS= read -r -d '' file; do
  filename="${file##*/}"
  awk -v filename="$filename" '$2 == filename { found = 1 } END { exit !found }' "$SUMS" || \
    fail "artifact is not covered by SHA256SUMS.txt: $filename"
done < <(find "$RELEASE_DIR" -maxdepth 1 -type f ! -name SHA256SUMS.txt -print0)

(
  cd "$ROOT_DIR"
  shasum -a 256 -c "$DEPENDENCY_LOCKS"
) || fail 'dependency lockfile digest does not match the release record'

verify_macos_archive "$RELEASE_DIR/$MACOS_ARCHIVE" "$VERSION"

mcp_package_version="$(tar -xOf "$RELEASE_DIR/$MCP_PACKAGE" package/package.json | node -e 'let body = ""; process.stdin.on("data", (chunk) => body += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(body).version));')" || \
  fail 'cannot read package.json from MCP package'
[[ "$mcp_package_version" == "$VERSION" ]] || \
  fail "MCP package version $mcp_package_version does not match release version $VERSION"

mcp_bundle_version="$(unzip -p "$RELEASE_DIR/$MCP_BUNDLE" manifest.json | node -e 'let body = ""; process.stdin.on("data", (chunk) => body += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(body).version));')" || \
  fail 'cannot read manifest.json from MCP bundle'
[[ "$mcp_bundle_version" == "$VERSION" ]] || \
  fail "MCP bundle version $mcp_bundle_version does not match release version $VERSION"

unzip -Z1 "$RELEASE_DIR/$MARKETPLACE_KIT" | grep -Fx 'Project Ambient Marketplace Kit/homebrew/project-ambient.rb' >/dev/null || \
  fail 'marketplace kit is missing the Homebrew cask'
unzip -Z1 "$RELEASE_DIR/$SOURCE_ARCHIVE" | grep -F 'README.md' >/dev/null || \
  fail 'source archive is missing README.md'

if [[ "$REQUIRE_HOMEBREW" == true ]]; then
  "$ROOT_DIR/script/verify_homebrew_cask.sh" --release-dir "$RELEASE_DIR"
fi

printf 'Release artifact verification passed for %s.\n' "$RELEASE_DIR"
