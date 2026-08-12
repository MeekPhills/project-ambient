# Energy Benchmark Method

Project Ambient does not claim “low power” without a reproducible measurement.

## Scenarios

Measure a five-minute warm period followed by a 15-minute sample for each scenario:

1. App open and idle on AC.
2. App hidden with no rule transition.
3. Paused by user.
4. Paused by power policy.
5. Static wallpaper apply every 15 minutes.
6. Aerial video delegated at the project’s recommended settings.
7. Sleep/wake and display reconnect recovery.

Record Mac model, chip, memory, macOS version, display resolution/count, media codec/resolution, Reduce Motion, Low Power Mode, and renderer version.

## Measures

- CPU time and wakeups from Activity Monitor or Instruments.
- Energy Impact and GPU time when available.
- Memory footprint.
- Bytes read/written.
- Whether media decoding is active.
- Apply and recovery latency.
- Thermal state and battery/AC status.

Report medians and ranges, not a single best run. Compare against an idle baseline on the same machine. Do not compare Project Ambient’s orchestration overhead to another product’s full renderer without labeling the boundary.

## Alpha budgets

- User-paused state: no media decoding and no repeating sub-minute poll.
- Hidden idle state: no continuous work except event subscriptions.
- Static rules: evaluate on relevant events or the next scheduled boundary, not every second.
- Recovery: restore a still within five seconds of a renderer failure on supported fixtures.
- Diagnostics: clearly say why motion is paused or why a fallback occurred.
