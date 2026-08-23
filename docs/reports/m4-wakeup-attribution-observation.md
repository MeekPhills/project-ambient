# Base-M4 wakeup-series and attribution observation

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Captured:** 2026-08-23
**Qualification:** partial wakeup-distribution evidence only

## Reproducible collector

`script/measure_m4_wakeup_series.sh` compiles the public
`proc_pid_rusage` helper, takes one snapshot per requested interval, and passes
the temporary JSON Lines stream through
`script/summarize_process_rusage_series.mjs`. Every probe call verifies the
target executable basename is `Ambient` before and after reading counters; the
summarizer also fails closed on a changed process-start token, an unexpected
snapshot count, non-monotonic time, counter regression, an invalid package-idle
subset, unsafe numeric deltas, malformed snapshot keys, or invalid input. Event
details are capped at 256 entries while aggregate totals remain exact. Each
relative event offset is the end of a sampling bucket; the counter change
occurred sometime during the preceding interval, not necessarily at the
printed instant. Temporary raw snapshots and the helper binary are removed on
exit. The collector rejects plans longer than 259,200 seconds (72 hours), even
when a caller combines an allowed sample count with a larger interval.

The output contains only the fixture ID, PID, UTC start/end timestamps, sample
configuration, public counter deltas, and relative event offsets. It contains
no host identifier, environment, path, filename, media, prompt, credential, or
location data. Coverage and qualification remain explicitly partial.

Command:

```bash
./script/measure_m4_wakeup_series.sh 1042 301 1
```

Final-script output:

```json
{
  "fixtureId": "base-2024-m4-mac-mini-16gb-256gb",
  "pid": 1042,
  "startedAt": "2026-08-23T10:55:23Z",
  "completedAt": "2026-08-23T11:00:29Z",
  "samples": 301,
  "intervalSeconds": 1,
  "processRusageSeries": {
    "available": true,
    "reason": null,
    "snapshotCount": 301,
    "elapsedSeconds": 305.78107,
    "packageIdleWakeups": 0,
    "interruptWakeups": 0,
    "totalWakeups": 0,
    "wakeupsPerMinute": 0,
    "diskReadBytes": 0,
    "diskWrittenBytes": 0,
    "activityEventCount": 0,
    "reportedActivityEventCount": 0,
    "activityEventsTruncated": false,
    "activityEvents": []
  },
  "budgetObservation": {
    "wakeupsPerMinuteCeiling": 2,
    "observedWindowRateWithinCeiling": true,
    "contractConformance": null,
    "contractConformanceReason": "requires-p95-after-warm-up-and-complete-fixture"
  },
  "storageObservation": {
    "writesObservedInWindow": false
  },
  "measurementCoverage": {
    "wakeups": "partial",
    "storageChurn": "partial"
  },
  "qualification": "partial-wakeup-series-only"
}
```

## Window comparison

| Window | Interrupt wakeups | Rate | Distribution | Disk delta |
| --- | ---: | ---: | --- | --- |
| PR #60 final-code static observation, 60.006 s | 3 | 2.9997/min | Aggregate only | 0 B read / 0 B written |
| First unprofiled one-second series, 304.398 s | 12 | 2.3653/min | Ten wakeup buckets plus one disk-only bucket; irregular, including one three-wakeup burst | 64 KiB read / 0 B written |
| Pre-review unprofiled series at `3834708`, 305.302 s | 2 | 0.3931/min | Two nonzero buckets whose end offsets were 11.19 s apart near the end | 0 B read / 0 B written |
| Corrected identity-bound series above, 305.781 s | 0 | 0/min | No nonzero buckets | 0 B read / 0 B written |

The corrected window and the pre-review five-minute window were below the
two-wakeup-per-minute ceiling, but the first five-minute window and the
one-minute observation were above it. The wakeups are neither a stable cadence
nor a reproducible pass. The explicit `contractConformance: null` prevents a
single-window comparison from being read as the required P95 result. These
short windows do not establish a P95, endurance result, or Base-M4
qualification.

## Attribution attempts and limits

- A source scan found no fixed-cadence polling loop, file watcher, `Task.sleep`,
  or `TimelineView`. Ambient does have one recursively re-armed one-shot
  scheduler. Its next boundary can represent 15/30-minute rotation cadence,
  pause expiration, temporary-channel expiration, or a rule transition. The
  recorded windows did not preserve that scheduler's pending boundary, so it
  cannot be excluded as a source.
- Xcode's Power Profiler template refused to record because it is unsupported
  on macOS. No value was inferred from that failure.
- A no-elevation System Trace attempt retained raw host UUID, environment,
  username, and paths before those fields were discovered. That collection
  breached issue #28's prohibited-diagnostics stop condition. It is
  non-compliant, contributes no evidence, must not be repeated, and its raw
  trace and orphaned kernel streams were deleted rather than committed.
- A two-minute target-only Time Profiler attempt was bounded to 15 MiB. The
  bracketing rusage interval observed one interrupt/package-idle wakeup in
  132.157 seconds, but the trace contained no ordinary Ambient CPU sample or
  run-loop event; only the profiler's terminal stackshot appeared. The raw
  trace and its temporary stream were deleted, contribute no attribution
  evidence, and are not a workflow to repeat.
- Unified logging contained no Ambient entries during the first five-minute
  series, so lifecycle/display/power/state notification delivery could not be
  correlated.

No concrete user-space source is attributed by this evidence. The next safe
step is privacy-minimized app signposts around the existing lifecycle,
display, power, clock, state-change, and rotation-boundary handlers, followed
by repeated unprofiled series windows. A signpost match can identify an app
event; absence of a match must remain an unattributed framework/kernel wakeup,
not a guessed cause. The wakeup ceiling remains unchanged.
