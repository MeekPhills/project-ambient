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
- Resident set size (RSS): the process's resident pages as reported by the
  sampling tool. The settled-static budget is an absolute maximum, not a P95.
- Physical footprint: the public `RUSAGE_INFO_V3.ri_phys_footprint` gauge. It
  has its own settled-static nearest-rank P95 budget and never substitutes for
  RSS.
- Bytes read/written.
- Whether media decoding is active.
- Apply and recovery latency.
- Thermal state and battery/AC status.

Report medians and ranges, not a single best run. Compare against an idle baseline on the same machine. Do not compare Project Ambient’s orchestration overhead to another product’s full renderer without labeling the boundary.

For a qualifying P95, complete the five-minute controlled warm-up first, then
collect the full 15-minute scenario window at the declared cadence on the
required hardware, content, display, power, and app-state fixture. Sort all
accepted samples in ascending order and select nearest rank
`ceil(0.95 * sampleCount)` using one-based indexing. Convert byte gauges to MiB
only by dividing by 1,048,576. Also report the maximum as diagnostic evidence;
it does not replace a P95 ceiling. Missing, malformed, interrupted, identity-
changed, or fixture-mismatched samples make that measure unqualified rather
than permitting extrapolation from a shorter window.

The settled-static wakeup scenario uses five predeclared trials, each launching
a fresh process instance of the same exact candidate artifact. Each trial
completes a separate 300-second warm-up before a 900-second
signposts-off window containing 901 snapshots on absolute one-second monotonic
deadlines. Normalize every valid window against the fixed fifteen-minute
duration, then apply nearest-rank P95 across all five rates; rank five is the
maximum observed rate. A missing, replaced, extra, or invalid trial makes the
set incomplete. Never select the best five attempts, pool per-second zeroes, or
divide by an unexpectedly long elapsed time to dilute a wakeup rate.
The retained window summary must preserve fresh-process and warm-up completion,
observed sampling-gap extrema, maximum cross-clock drift, process/candidate
continuity, and fixture/scenario stability so raw-row deletion does not make an
eligibility decision unauditable.

Hardware capability is not runtime activity. A public report that HEVC hardware
decode is supported does not prove that a decoder session was created, that a
particular session is hardware-backed, or that resources remain available for
a particular profile, level, resolution, frame rate, HDR mode, or rendition.
Likewise, discovering a Metal device does not measure
GPU work, utilization, frame pacing, or downstream compositor activity. Keep
decoder and GPU coverage `unmeasured` until an app-owned playback pipeline can
count its own decompression sessions and command submissions, and until the
required runtime fixture is observed. Never infer those metrics from device
availability or from one logical `AVPlayer` instance.

## Alpha budgets

- User-paused state: no media decoding and no repeating sub-minute poll.
- Hidden idle state: no continuous work except event subscriptions.
- Static rules: evaluate on relevant events or the next scheduled boundary, not every second.
- Recovery: restore a still within five seconds of a renderer failure on supported fixtures.
- Diagnostics: clearly say why motion is paused or why a fallback occurred.
