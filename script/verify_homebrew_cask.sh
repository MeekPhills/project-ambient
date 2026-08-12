#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORMULA="$ROOT_DIR/distribution/homebrew/project-ambient.rb"
RELEASE_DIR=""

usage() {
  cat <<'EOF'
usage: verify_homebrew_cask.sh [--formula <path>] [--release-dir <path>]

Without --release-dir, validate the cask's static contract. With --release-dir,
also require the cask version and SHA-256 to match the notarized release artifact
named in release-manifest.json.
EOF
}

fail() {
  printf 'Homebrew cask verification failed: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --formula)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      FORMULA="$2"
      shift 2
      ;;
    --release-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      RELEASE_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

[[ -f "$FORMULA" ]] || fail "formula does not exist: $FORMULA"

formula_version="$(sed -nE 's/^  version "([^"]+)"$/\1/p' "$FORMULA")"
formula_sha="$(sed -nE 's/^  sha256 "([0-9a-f]{64})"$/\1/p' "$FORMULA")"

[[ "$(sed -nE 's/^cask "([^"]+)" do$/\1/p' "$FORMULA")" == "project-ambient" ]] || \
  fail 'cask must be named project-ambient'
[[ "$formula_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || \
  fail "invalid semantic version: ${formula_version:-<missing>}"
[[ "$formula_sha" =~ ^[0-9a-f]{64}$ ]] || fail 'sha256 must be a 64-character lowercase hexadecimal digest'

rg -Fq 'url "https://github.com/MeekPhills/project-ambient/releases/download/v#{version}/Project-Ambient-#{version}.zip"' "$FORMULA" || \
  fail 'release URL must interpolate the cask version and canonical archive name'
rg -Fq 'app "Project Ambient/Project Ambient.app"' "$FORMULA" || \
  fail 'app stanza does not match the release archive layout'
rg -Fq 'binary "Project Ambient/ambientctl"' "$FORMULA" || \
  fail 'binary stanza does not match the release archive layout'
rg -Fq 'depends_on macos: ">= :sonoma"' "$FORMULA" || \
  fail 'minimum macOS version must remain aligned with the native package (macOS 14)'

if [[ -n "$RELEASE_DIR" ]]; then
  MANIFEST="$RELEASE_DIR/release-manifest.json"
  SUMS="$RELEASE_DIR/SHA256SUMS.txt"
  [[ -f "$MANIFEST" ]] || fail "release manifest does not exist: $MANIFEST"
  [[ -f "$SUMS" ]] || fail "release checksum file does not exist: $SUMS"

  release_version="$(node - "$MANIFEST" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(manifest.version ?? ''));
NODE
  )"
  archive_name="$(node - "$MANIFEST" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(manifest.artifacts?.macosArchive ?? ''));
NODE
  )"

  [[ "$release_version" == "$formula_version" ]] || \
    fail "formula version $formula_version does not match release version $release_version"
  [[ "$archive_name" == "Project-Ambient-$release_version.zip" ]] || \
    fail "release manifest must promote the canonical archive name, found: ${archive_name:-<missing>}"
  [[ -f "$RELEASE_DIR/$archive_name" ]] || fail "release archive does not exist: $RELEASE_DIR/$archive_name"

  archive_sha="$(awk -v name="$archive_name" '$2 == name { print $1 }' "$SUMS")"
  [[ "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || fail "no valid checksum entry for $archive_name"
  [[ "$archive_sha" == "$formula_sha" ]] || \
    fail "formula SHA-256 does not match the promoted release archive"

  if rg -q '^  depends_on arch:' "$FORMULA"; then
    fail 'a universal release cannot retain an architecture restriction in the cask'
  fi
fi

printf 'Homebrew cask contract passed%s.\n' "${RELEASE_DIR:+ against $RELEASE_DIR}"
