#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  printf 'usage: %s <pid> [samples=301] [interval-seconds=1]\n' "$0" >&2
  exit 2
fi

PID="$1"
SAMPLES="${2:-301}"
INTERVAL="${3:-1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_PATH="$ROOT_DIR/fixtures/resource-budgets/v1/base-m4-mac-mini.json"
RUSAGE_SOURCE="$ROOT_DIR/script/macos_process_rusage.c"
SUMMARIZER="$ROOT_DIR/script/summarize_process_rusage_series.mjs"

if [[ ! "$PID" =~ ^[1-9][0-9]*$ ]] || [[ ! "$SAMPLES" =~ ^[1-9][0-9]*$ ]] || [[ ! "$INTERVAL" =~ ^([1-9][0-9]*|0[.][0-9]*[1-9][0-9]*)$ ]]; then
  printf 'pid must be a positive integer, samples must be an integer from 2 through 259201, and interval must be a positive decimal number.\n' >&2
  exit 2
fi
if (( SAMPLES < 2 || SAMPLES > 259201 )); then
  printf 'samples must be an integer from 2 through 259201.\n' >&2
  exit 2
fi
if ! ps -p "$PID" >/dev/null 2>&1; then
  printf 'process %s is not running.\n' "$PID" >&2
  exit 1
fi
for tool in node xcrun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '%s is required for the public process-rusage series.\n' "$tool" >&2
    exit 1
  fi
done
if ! node -e 'const samples = Number(process.argv[1]); const interval = Number(process.argv[2]); if (!Number.isFinite(interval) || interval <= 0 || (samples - 1) * interval > 259200) process.exit(1);' "$SAMPLES" "$INTERVAL"; then
  printf 'planned sampling duration must not exceed 259200 seconds (72 hours).\n' >&2
  exit 2
fi

fixture_values="$(node -e 'const fs = require("node:fs"); const fixture = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const ceiling = fixture?.budgets?.staticSettled?.wakeupsPerMinuteMax; if (typeof fixture?.fixtureId !== "string" || fixture.fixtureId.length === 0 || !Number.isFinite(ceiling) || ceiling < 0) { console.error("resource fixture is missing a valid fixture ID or wakeup ceiling"); process.exit(1); } process.stdout.write([fixture.fixtureId, ceiling].join("\t"));' "$FIXTURE_PATH")"
IFS=$'\t' read -r fixture_id wakeup_ceiling <<<"$fixture_values"

MEASURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ambient-wakeup-series.XXXXXX")"
trap 'rm -rf "$MEASURE_DIR"' EXIT
RUSAGE_PROBE="$MEASURE_DIR/macos_process_rusage"
SNAPSHOTS="$MEASURE_DIR/snapshots.jsonl"

xcrun clang -std=c11 -Wall -Wextra -Werror "$RUSAGE_SOURCE" -o "$RUSAGE_PROBE"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for ((sample = 0; sample < SAMPLES; sample += 1)); do
  "$RUSAGE_PROBE" "$PID" Ambient >> "$SNAPSHOTS"
  if (( sample + 1 < SAMPLES )); then sleep "$INTERVAL"; fi
done
completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

summary="$(node "$SUMMARIZER" 256 "$SAMPLES" < "$SNAPSHOTS")"
node -e 'const summary = JSON.parse(process.argv[1]); const ceiling = Number(process.argv[7]); const output = { fixtureId: process.argv[2], pid: Number(process.argv[3]), startedAt: process.argv[4], completedAt: process.argv[5], samples: summary.snapshotCount, intervalSeconds: Number(process.argv[6]), processRusageSeries: summary, budgetObservation: { wakeupsPerMinuteCeiling: ceiling, observedWindowRateWithinCeiling: summary.wakeupsPerMinute <= ceiling, contractConformance: null, contractConformanceReason: "requires-p95-after-warm-up-and-complete-fixture" }, storageObservation: { writesObservedInWindow: summary.diskWrittenBytes > 0 }, measurementCoverage: { wakeups: "partial", storageChurn: "partial" }, qualification: "partial-wakeup-series-only" }; process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);' "$summary" "$fixture_id" "$PID" "$started_at" "$completed_at" "$INTERVAL" "$wakeup_ceiling"
