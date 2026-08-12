#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$ROOT_DIR/services/mcp"
MCPB_TOOLING_DIR="$ROOT_DIR/script/mcpb-tooling"
MCPB_CLI_VERSION="2.1.2"
OUTPUT="${1:-$ROOT_DIR/dist/release/project-ambient-control.mcpb}"

usage() {
  cat <<'EOF'
usage: build_mcpb_release.sh [output-path]

Build the MCP bundle from the already-compiled MCP service. The packer is installed
from the committed script/mcpb-tooling package-lock.json and run as a local binary.
This command requires npm registry access, but isolates npm configuration so it does
not read or send maintainer registry credentials.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

command -v npm >/dev/null 2>&1 || { printf 'npm is required to build the MCP bundle.\n' >&2; exit 1; }
[[ -f "$MCPB_TOOLING_DIR/package.json" && -f "$MCPB_TOOLING_DIR/package-lock.json" ]] || {
  printf 'Locked MCPB tooling is missing from %s.\n' "$MCPB_TOOLING_DIR" >&2
  exit 1
}
node - "$MCPB_TOOLING_DIR/package-lock.json" "$MCPB_CLI_VERSION" <<'NODE'
const fs = require('node:fs');
const [lockPath, expectedVersion] = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const packer = lock.packages?.['node_modules/@anthropic-ai/mcpb'];
if (lock.lockfileVersion !== 3 || packer?.version !== expectedVersion || typeof packer.integrity !== 'string') {
  process.stderr.write('Locked MCPB tool is missing its expected version or integrity digest.\n');
  process.exit(1);
}
NODE
[[ -d "$MCP_DIR/dist/src" ]] || {
  printf 'MCP build output is missing. Run npm --prefix %s run build first.\n' "$MCP_DIR" >&2
  exit 1
}

OUTPUT_PARENT="$(dirname "$OUTPUT")"
mkdir -p "$OUTPUT_PARENT"
OUTPUT_PARENT="$(cd "$OUTPUT_PARENT" && pwd)"
WORK_DIR="$(mktemp -d "$OUTPUT_PARENT/.mcpb-staging.XXXXXX")"
NPM_CACHE="$WORK_DIR/npm-cache"
STAGE_DIR="$WORK_DIR/mcpb-stage"
TOOLING_STAGE_DIR="$WORK_DIR/mcpb-tooling"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$STAGE_DIR/dist" "$TOOLING_STAGE_DIR"
for entry in package.json package-lock.json LICENSE; do
  cp "$MCP_DIR/$entry" "$STAGE_DIR/$entry"
done
cp -R "$MCP_DIR/dist/src" "$STAGE_DIR/dist/src"
cp "$MCP_DIR/packaging/mcpb/manifest.json" "$STAGE_DIR/manifest.json"
cp "$MCPB_TOOLING_DIR/package.json" "$MCPB_TOOLING_DIR/package-lock.json" "$TOOLING_STAGE_DIR"/

(
  export npm_config_cache="$NPM_CACHE"
  export npm_config_userconfig=/dev/null
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_update_notifier=false
  npm --prefix "$TOOLING_STAGE_DIR" ci --ignore-scripts
  npm --prefix "$STAGE_DIR" ci --omit=dev --ignore-scripts
  "$TOOLING_STAGE_DIR/node_modules/.bin/mcpb" pack "$STAGE_DIR" "$OUTPUT"
)

[[ -f "$OUTPUT" ]] || { printf 'MCP bundle was not created: %s\n' "$OUTPUT" >&2; exit 1; }
printf 'MCP bundle created with @anthropic-ai/mcpb@%s: %s\n' "$MCPB_CLI_VERSION" "$OUTPUT"
