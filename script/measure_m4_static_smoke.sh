#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  printf 'usage: %s <pid> [samples=60] [interval-seconds=1]\n' "$0" >&2
  exit 2
fi

PID="$1"
SAMPLES="${2:-60}"
INTERVAL="${3:-1}"

if [[ ! "$PID" =~ ^[0-9]+$ ]] || [[ ! "$SAMPLES" =~ ^[1-9][0-9]*$ ]] || [[ ! "$INTERVAL" =~ ^([1-9][0-9]*|0[.][0-9]*[1-9][0-9]*)$ ]]; then
  printf 'pid and samples must be positive integers; interval must be a positive number.\n' >&2
  exit 2
fi
if ! ps -p "$PID" >/dev/null 2>&1; then
  printf 'process %s is not running.\n' "$PID" >&2
  exit 1
fi

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

printf '{\n'
printf '  "pid": %s,\n' "$PID"
printf '  "capturedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '  "samples": %s,\n' "$SAMPLES"
printf '  "intervalSeconds": %s,\n' "$INTERVAL"
printf '  "cpuPercentP95": %s,\n' "$(p95 "$CPU_FILE")"
printf '  "cpuPercentMax": %s,\n' "$(sort -n "$CPU_FILE" | tail -1)"
printf '  "rssMiBP95": %.2f,\n' "$(p95 "$RSS_FILE" | awk '{ print $1 / 1024 }')"
printf '  "rssMiBMax": %.2f,\n' "$(sort -n "$RSS_FILE" | tail -1 | awk '{ printf $1 / 1024 }')"
printf '  "openNetworkEndpoints": %s,\n' "$network_endpoints"
printf '  "wakeupsPerMinute": null,\n'
printf '  "decoderSessions": null,\n'
printf '  "qualification": "partial-static-smoke-only"\n'
printf '}\n'
