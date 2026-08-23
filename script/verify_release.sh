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
run node "$ROOT_DIR/script/validate_m4_static_wakeup_qualification.mjs"
run node "$ROOT_DIR/script/validate_m4_static_wakeup_preflight.mjs"
run node "$ROOT_DIR/script/summarize_process_rusage_series.mjs" --self-test
run node "$ROOT_DIR/script/sanitize_m4_wakeup_signposts.mjs" --self-test
run node "$ROOT_DIR/script/validate_macos_media_capability_probe.mjs" --self-test
if [[ "$(uname -s)" == "Darwin" ]]; then
  run xcrun clang -std=c11 -Wall -Wextra -Werror -fsyntax-only "$ROOT_DIR/script/macos_process_rusage.c"
  PREFLIGHT_PRODUCER_REVISION="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  [[ "$PREFLIGHT_PRODUCER_REVISION" =~ ^[a-f0-9]{40}$ ]] || {
    printf '\nStatic-wakeup preflight producer revision is invalid.\n' >&2
    exit 1
  }
  PREFLIGHT_PRODUCTION_BINARY="$(mktemp "${TMPDIR:-/tmp}/ambient-static-wakeup-preflight-production.XXXXXX")"
  PREFLIGHT_TEST_BINARY="$(mktemp "${TMPDIR:-/tmp}/ambient-static-wakeup-preflight-test.XXXXXX")"
  PREFLIGHT_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/ambient-static-wakeup-preflight-output.XXXXXX")"
  MEDIA_PROBE_BINARY="$(mktemp "${TMPDIR:-/tmp}/ambient-media-capability.XXXXXX")"
  trap 'rm -f "$PREFLIGHT_PRODUCTION_BINARY" "$PREFLIGHT_TEST_BINARY" "$PREFLIGHT_OUTPUT" "$MEDIA_PROBE_BINARY"' EXIT
  run xcrun clang -fobjc-arc -fblocks -fmodules -mmacosx-version-min=14.0 -Wall -Wextra -Werror \
    "-DAMBIENT_PREFLIGHT_PRODUCER_REVISION=\"$PREFLIGHT_PRODUCER_REVISION\"" \
    "$ROOT_DIR/script/macos_static_wakeup_preflight.m" \
    -framework Foundation \
    -o "$PREFLIGHT_PRODUCTION_BINARY"
  printf '\n› validate blocked production static-wakeup preflight output\n'
  set +e
  (
    cd "$ROOT_DIR"
    "$PREFLIGHT_PRODUCTION_BINARY" > "$PREFLIGHT_OUTPUT"
  )
  PREFLIGHT_STATUS=$?
  "$PREFLIGHT_PRODUCTION_BINARY" --self-test >/dev/null 2>&1
  PREFLIGHT_ARGUMENT_STATUS=$?
  set -e
  [[ "$PREFLIGHT_STATUS" -eq 1 ]] || {
    printf '\nCurrent-plan preflight must stop with exit status 1; received %s.\n' "$PREFLIGHT_STATUS" >&2
    exit 1
  }
  [[ "$PREFLIGHT_ARGUMENT_STATUS" -eq 2 ]] || {
    printf '\nProduction preflight must reject --self-test with exit status 2; received %s.\n' "$PREFLIGHT_ARGUMENT_STATUS" >&2
    exit 1
  }
  run node "$ROOT_DIR/script/validate_m4_static_wakeup_preflight.mjs" --validate-output < "$PREFLIGHT_OUTPUT"
  run xcrun clang -fobjc-arc -fblocks -fmodules -mmacosx-version-min=14.0 -Wall -Wextra -Werror \
    "-DAMBIENT_PREFLIGHT_PRODUCER_REVISION=\"$PREFLIGHT_PRODUCER_REVISION\"" \
    -DAMBIENT_PREFLIGHT_TESTING=1 \
    "$ROOT_DIR/script/macos_static_wakeup_preflight.m" \
    -framework Foundation \
    -o "$PREFLIGHT_TEST_BINARY"
  run "$PREFLIGHT_TEST_BINARY" --self-test
  run xcrun clang -fobjc-arc -fmodules -mmacosx-version-min=14.0 -Wall -Wextra -Werror \
    "$ROOT_DIR/script/macos_media_capability_probe.m" \
    -framework CoreMedia -framework Foundation -framework Metal -framework VideoToolbox \
    -o "$MEDIA_PROBE_BINARY"
  printf '\n› validate public macOS media capability probe output\n'
  "$MEDIA_PROBE_BINARY" | node "$ROOT_DIR/script/validate_macos_media_capability_probe.mjs"
fi
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
