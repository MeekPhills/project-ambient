#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

run() {
  printf '\n› %s\n' "$*"
  "$@"
}

run swift build "${SWIFT_FLAGS[@]}"
run swift test "${SWIFT_FLAGS[@]}"
run node "$ROOT_DIR/script/validate_capabilities.mjs"
run node "$ROOT_DIR/script/validate_rights.mjs"
run node "$ROOT_DIR/script/validate_aerial_parity.mjs"
run node "$ROOT_DIR/script/validate_display_control.mjs"
run node "$ROOT_DIR/script/validate_resource_budgets.mjs"
if [[ "${PROJECT_AMBIENT_GA:-0}" == "1" ]]; then
  run node "$ROOT_DIR/script/validate_aerial_parity.mjs" --ga
fi

if [[ -d "$ROOT_DIR/services/mcp/node_modules" ]]; then
  run npm --prefix "$ROOT_DIR/services/mcp" run check
  run npm --prefix "$ROOT_DIR/services/mcp" test
  run npm --prefix "$ROOT_DIR/services/mcp" run build
else
  printf '\nMCP dependencies are not installed; run npm ci in services/mcp first.\n' >&2
  exit 1
fi

if [[ -d "$ROOT_DIR/apps/site/node_modules" ]]; then
  run npm --prefix "$ROOT_DIR/apps/site" run build
else
  printf '\nSite dependencies are not installed; run npm ci in apps/site first.\n' >&2
  exit 1
fi

if grep -RInE --exclude-dir=.git --exclude-dir=node_modules \
  '(gho_|ghp_)[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----' "$ROOT_DIR"; then
  printf '\nPotential secret material found. Review before release.\n' >&2
  exit 1
fi

printf '\nProject Ambient release verification passed.\n'
