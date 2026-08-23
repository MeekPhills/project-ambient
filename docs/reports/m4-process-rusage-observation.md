# Base-M4 process-resource observation

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Captured:** 2026-08-23
**Producer revision:** `5f23aebc55658b4b94b0adc37ef06b42c30bf117`
**Qualification:** partial settled-static evidence only

The exact output below is frozen to that producer revision.
`de6021c3b7e37bd06a3a44bf886543420bfc0e21` subsequently corrected the wakeup-
accounting semantics without changing these captured values because package-
idle wakeups were zero. Later collectors sample every rusage row, add physical-
footprint gauges, and evaluate the RSS maximum under a renamed field; those
changes do not rewrite this historical JSON.

## Method

`script/measure_m4_static_smoke.sh` compiled the small public-API helper at
`script/macos_process_rusage.c` with the active macOS SDK, then sampled the
running Ambient process 60 times at one-second intervals. The helper took
before-and-after `proc_pid_rusage` snapshots using `RUSAGE_INFO_V3` and measured
elapsed time with `CLOCK_MONOTONIC_RAW`. It also bound both snapshots to the
same process-start token and treated 64-bit counters as decimal strings until
validated deltas were safely representable.

The reported wakeup rate uses the process's interrupt-wakeup delta. Apple's
[XNU scheduler accounting](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/sched_prim.c#L897-L902)
credits every qualifying wakeup to the interrupt ledger and conditionally also
credits the platform-idle ledger; the
[rusage mapping](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/bsd_kern.c#L1257-L1260)
exposes those as interrupt and package-idle counters. Package-idle wakeups are
therefore a diagnostic subset, so the harness validates that relationship and
does not add the counters.
Disk activity is the process-attributable read/write byte delta over the same
interval. The helper needs no elevation, private API, identifier collection, or
persistent service. When the compiler or either snapshot is unavailable, the
harness reports an explicit unavailable reason and leaves both coverage rows
unmeasured.

Command:

```bash
./script/measure_m4_static_smoke.sh 1042 60 1
```

Exact output:

```json
{
  "fixtureId": "base-2024-m4-mac-mini-16gb-256gb",
  "pid": 1042,
  "capturedAt": "2026-08-23T09:50:46Z",
  "samples": 60,
  "intervalSeconds": 1,
  "cpuPercentP95": 0.0,
  "cpuPercentMax": 0.1,
  "rssMiBP95": 15.12,
  "rssMiBMax": 15.14,
  "openNetworkEndpoints": 0,
  "displayTopology": {
    "available": true,
    "onlineDisplayCount": 1,
    "fixtureDisplayCountMatched": false,
    "displays": [
      {
        "resolution": "1920 x 1080 @ 120.00Hz",
        "online": true,
        "main": true,
        "mirrored": false,
        "asleep": true
      }
    ]
  },
  "processRusage": {
    "available": true,
    "reason": null,
    "elapsedSeconds": 60.00641675,
    "packageIdleWakeups": 0,
    "interruptWakeups": 3,
    "totalWakeups": 3,
    "wakeupsPerMinute": 2.9996791968085645,
    "diskReadBytes": 0,
    "diskWrittenBytes": 0
  },
  "budgetEvaluation": {
    "staticCpuP95WithinCeiling": true,
    "staticRssP95WithinCeiling": true,
    "staticWakeupsWithinCeiling": false,
    "networkEndpointsObserved": 0
  },
  "measurementCoverage": {
    "cpu": "partial",
    "rss": "partial",
    "wakeups": "partial",
    "network": "partial",
    "decoder": "unmeasured",
    "gpu": "unmeasured",
    "framePacing": "unmeasured",
    "storageChurn": "partial",
    "displayTopology": "partial",
    "pressure": "unmeasured",
    "soak": "unmeasured"
  },
  "wakeupsPerMinute": 2.9996791968085645,
  "decoderSessions": null,
  "qualification": "partial-static-smoke-only"
}
```

## Result and next action

The sampled process exceeded the fixture's static wakeup ceiling of two per
minute: three interrupt wakeups over 60.006 seconds produced 2.9997 wakeups per
minute. The ceiling is unchanged. Package-idle wakeups, disk reads, and disk
writes were zero. CPU and RSS were within their static ceilings during this
short observation, and no open network endpoint was observed.

This is not a Base-M4 qualification. The required dual-display fixture was not
attached, one minute is not the required P95/endurance matrix, and decoder/GPU,
frame pacing, pressure/failure behavior, the 1,000-item UI, and the 48-hour soak
remain incomplete. The next measurement slice should reproduce and attribute
the wakeup source with public tooling before any optimization or ceiling review.

The follow-up [wakeup-series observation](m4-wakeup-attribution-observation.md)
adds bounded event timing and records that independent five-minute windows vary
across both sides of the ceiling without identifying a concrete source.
The later [physical-footprint observation](m4-physical-footprint-observation.md)
samples public `ri_phys_footprint` on every row, keeps it separate from RSS, and
records a partial P95 result without changing either ceiling.
