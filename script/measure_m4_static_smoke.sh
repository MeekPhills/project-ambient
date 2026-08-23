#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  printf 'usage: %s <pid> [samples=60] [interval-seconds=1]\n' "$0" >&2
  exit 2
fi

PID="$1"
SAMPLES="${2:-60}"
INTERVAL="${3:-1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_PATH="$ROOT_DIR/fixtures/resource-budgets/v1/base-m4-mac-mini.json"

if [[ ! "$PID" =~ ^[0-9]+$ ]] || [[ ! "$SAMPLES" =~ ^[1-9][0-9]*$ ]] || [[ ! "$INTERVAL" =~ ^([1-9][0-9]*|0[.][0-9]*[1-9][0-9]*)$ ]]; then
  printf 'pid and samples must be positive integers; interval must be a positive number.\n' >&2
  exit 2
fi
if ! ps -p "$PID" >/dev/null 2>&1; then
  printf 'process %s is not running.\n' "$PID" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'node is required to read the resource-budget fixture.\n' >&2
  exit 1
fi
fixture_values="$(node -e 'const fs = require("node:fs"); const fixture = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write([fixture.fixtureId, fixture.budgets.staticSettled.cpuPercentP95Max, fixture.budgets.staticSettled.rssMiBMax, fixture.displayFixture.requiredDisplayCount].join("\t"));' "$FIXTURE_PATH")"
IFS=$'\t' read -r fixture_id cpu_ceiling rss_ceiling required_display_count <<<"$fixture_values"

MEASURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ambient-static-envelope.XXXXXX")"
trap 'rm -rf "$MEASURE_DIR"' EXIT
CPU_FILE="$MEASURE_DIR/cpu"
RSS_FILE="$MEASURE_DIR/rss"

for ((sample = 0; sample < SAMPLES; sample += 1)); do
  line="$(ps -o %cpu=,rss= -p "$PID" 2>/dev/null || true)"
  if [[ -z "$line" ]]; then
    printf 'process %s exited during sample %s.\n' "$PID" "$sample" >&2
    exit 1
  fi
  read -r cpu rss <<<"$line"
  printf '%s\n' "$cpu" >> "$CPU_FILE"
  printf '%s\n' "$rss" >> "$RSS_FILE"
  if (( sample + 1 < SAMPLES )); then sleep "$INTERVAL"; fi
done

p95() {
  local file="$1"
  local count rank
  count="$(wc -l < "$file" | tr -d ' ')"
  rank=$(( (95 * count + 99) / 100 ))
  sort -n "$file" | sed -n "${rank}p"
}

network_endpoints=0
if command -v lsof >/dev/null 2>&1; then
  network_endpoints="$({ lsof -n -a -p "$PID" -i 2>/dev/null || true; } | awk 'NR > 1 { count += 1 } END { print count + 0 }')"
fi

display_topology='{"available":false,"onlineDisplayCount":null,"fixtureDisplayCountMatched":false,"displays":[]}'
display_topology_coverage="unmeasured"
if command -v system_profiler >/dev/null 2>&1; then
  display_topology="$(system_profiler SPDisplaysDataType -json | node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const root = JSON.parse(input); const displays = (root.SPDisplaysDataType ?? []).flatMap((gpu) => gpu.spdisplays_ndrvs ?? []).map((display) => ({ resolution: display._spdisplays_resolution ?? display.spdisplays_resolution ?? "unknown", online: display.spdisplays_online === "spdisplays_yes", main: display.spdisplays_main === "spdisplays_yes", mirrored: display.spdisplays_mirror === "spdisplays_yes", asleep: display.spdisplays_asleep === "spdisplays_yes" })); const onlineDisplayCount = displays.filter((display) => display.online).length; process.stdout.write(JSON.stringify({ available: true, onlineDisplayCount, fixtureDisplayCountMatched: onlineDisplayCount === Number(process.argv[1]), displays })); });' "$required_display_count")"
  display_topology_coverage="partial"
fi

cpu_p95="$(p95 "$CPU_FILE")"
cpu_max="$(sort -n "$CPU_FILE" | tail -1)"
rss_p95="$(p95 "$RSS_FILE" | awk '{ print $1 / 1024 }')"
rss_max="$(sort -n "$RSS_FILE" | tail -1 | awk '{ print $1 / 1024 }')"
cpu_within_budget="$(awk -v value="$cpu_p95" -v ceiling="$cpu_ceiling" 'BEGIN { print (value <= ceiling ? "true" : "false") }')"
rss_within_budget="$(awk -v value="$rss_p95" -v ceiling="$rss_ceiling" 'BEGIN { print (value <= ceiling ? "true" : "false") }')"

printf '{\n'
printf '  "fixtureId": "%s",\n' "$fixture_id"
printf '  "pid": %s,\n' "$PID"
printf '  "capturedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '  "samples": %s,\n' "$SAMPLES"
printf '  "intervalSeconds": %s,\n' "$INTERVAL"
printf '  "cpuPercentP95": %s,\n' "$cpu_p95"
printf '  "cpuPercentMax": %s,\n' "$cpu_max"
printf '  "rssMiBP95": %.2f,\n' "$rss_p95"
printf '  "rssMiBMax": %.2f,\n' "$rss_max"
printf '  "openNetworkEndpoints": %s,\n' "$network_endpoints"
printf '  "displayTopology": %s,\n' "$display_topology"
printf '  "budgetEvaluation": { "staticCpuP95WithinCeiling": %s, "staticRssP95WithinCeiling": %s, "networkEndpointsObserved": %s },\n' "$cpu_within_budget" "$rss_within_budget" "$network_endpoints"
printf '  "measurementCoverage": { "cpu": "partial", "rss": "partial", "wakeups": "unmeasured", "network": "partial", "decoder": "unmeasured", "gpu": "unmeasured", "framePacing": "unmeasured", "storageChurn": "unmeasured", "displayTopology": "%s", "pressure": "unmeasured", "soak": "unmeasured" },\n' "$display_topology_coverage"
printf '  "wakeupsPerMinute": null,\n'
printf '  "decoderSessions": null,\n'
printf '  "qualification": "partial-static-smoke-only"\n'
printf '}\n'
