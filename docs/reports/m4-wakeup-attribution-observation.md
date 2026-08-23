# Base-M4 wakeup-series and attribution observation

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Captured:** 2026-08-23
**Qualification:** partial wakeup-distribution evidence only

## Reproducible collector

`script/measure_m4_wakeup_series.sh` compiles the public
`proc_pid_rusage` helper, takes one snapshot per requested interval, and passes
the temporary JSON Lines stream through
`script/summarize_process_rusage_series.mjs`. The summarizer fails closed on a
changed process-start token, non-monotonic time, counter regression, an invalid
package-idle subset, unsafe numeric deltas, malformed snapshot keys, or invalid
input. Event details are capped at 256 entries while aggregate totals remain
exact. Each relative event offset is the end of a sampling bucket; the counter
change occurred sometime during the preceding interval, not necessarily at the
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
  "startedAt": "2026-08-23T10:28:56Z",
  "completedAt": "2026-08-23T10:34:01Z",
  "samples": 301,
  "intervalSeconds": 1,
  "processRusageSeries": {
    "available": true,
    "reason": null,
    "elapsedSeconds": 305.302048959,
    "packageIdleWakeups": 0,
    "interruptWakeups": 2,
    "totalWakeups": 2,
    "wakeupsPerMinute": 0.39305337258354,
    "diskReadBytes": 0,
    "diskWrittenBytes": 0,
    "activityEventCount": 2,
    "reportedActivityEventCount": 2,
    "activityEventsTruncated": false,
    "activityEvents": [
      {
        "offsetSeconds": 254.493854417,
        "interruptWakeups": 1,
        "packageIdleWakeups": 0,
        "diskReadBytes": 0,
        "diskWrittenBytes": 0
      },
      {
        "offsetSeconds": 265.68730375,
        "interruptWakeups": 1,
        "packageIdleWakeups": 0,
        "diskReadBytes": 0,
        "diskWrittenBytes": 0
      }
    ]
  },
  "budgetEvaluation": {
    "staticWakeupsWithinCeiling": true,
    "storageWritesObserved": false
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
| Final-script unprofiled series above, 305.302 s | 2 | 0.3931/min | Two nonzero buckets whose end offsets were 11.19 s apart near the end | 0 B read / 0 B written |

The final-script window was below the two-wakeup-per-minute ceiling, but the
prior two windows were above it. The wakeups are neither a stable three-per-
minute cadence nor a reproducible pass. These short windows do not establish a
P95, endurance result, or Base-M4 qualification.

## Attribution attempts and limits

- A source scan found no repeating app-owned timer, polling loop, file watcher,
  `Task.sleep`, `TimelineView`, or self-rescheduling callback. The only runtime
  timer is a one-shot rotation boundary whose normal cadence is 15 or 30
  minutes.
- Xcode's Power Profiler template refused to record because it is unsupported
  on macOS. No value was inferred from that failure.
- A no-elevation System Trace retained raw host UUID, environment, username,
  and paths and generated multi-gigabyte temporary kernel streams. Its retained
  ten-second window captured no Ambient run-loop, syscall, or CPU sample. The
  raw trace and orphaned kernel streams were deleted and are not committed.
- A two-minute target-only Time Profiler trace was bounded to 15 MiB. The
  bracketing rusage interval observed one interrupt/package-idle wakeup in
  132.157 seconds, but the trace contained no ordinary Ambient CPU sample or
  run-loop event; only the profiler's terminal stackshot appeared. The raw
  trace and its temporary stream were deleted and are not committed.
- Unified logging contained no Ambient entries during the first five-minute
  series, so lifecycle/display/power/state notification delivery could not be
  correlated.

No concrete user-space source is attributed by this evidence. The next safe
step is privacy-minimized app signposts around the existing lifecycle,
display, power, clock, state-change, and rotation-boundary handlers, followed
by repeated unprofiled series windows. A signpost match can identify an app
event; absence of a match must remain an unattributed framework/kernel wakeup,
not a guessed cause. The wakeup ceiling remains unchanged.
