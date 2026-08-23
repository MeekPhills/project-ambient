# Base-M4 physical-footprint observation

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Captured:** 2026-08-23T13:06:50Z
**Producer revision:** `91fc69c23597c308526fcdd25983d97939a34d4d`
**Qualification:** partial settled-static observation only — no M4 certification or tracker credit

## Method

At the exact producer revision above, `script/measure_m4_static_smoke.sh`
sampled one already-running Ambient process
60 times at a requested one-second interval. On every sample, the bounded helper
in `script/macos_process_rusage.c` used public `proc_pid_rusage` with
`RUSAGE_INFO_V3` and retained `ri_phys_footprint` as a 64-bit gauge. Every row
was bound to the `Ambient` executable and the same process-start identity.

`script/summarize_process_rusage_series.mjs` computed nearest-rank P95 and
maximum values over all 60 gauges without treating gauge movement as wakeup or
disk activity. The temporary JSON Lines samples and helper binary were removed
on exit. Retained output contains no filenames, media paths or content, prompts,
credentials, hardware serials, host identity, or location data.

RSS and physical footprint use different accounting domains and are reported
separately. A physical-footprint result inside its ceiling cannot cancel an RSS
failure. The running installed app was suitable for this bounded harness check,
but this observation does not establish release-candidate provenance, warm-up
control, the required two-display fixture, or endurance. The harness also did
not independently attest the app's active mode or window visibility, so the
result cannot be promoted from partial evidence.

Command:

```bash
./script/measure_m4_static_smoke.sh 41423 60 1
```

## Exact sanitized output

```json
{
  "fixtureId": "base-2024-m4-mac-mini-16gb-256gb",
  "pid": 41423,
  "capturedAt": "2026-08-23T13:06:50Z",
  "samples": 60,
  "intervalSeconds": 1,
  "cpuPercentP95": 0.0,
  "cpuPercentMax": 0.0,
  "rssMiBP95": 85.23,
  "rssMiBMax": 85.23,
  "physicalFootprintMiBP95": 30.891517639160156,
  "physicalFootprintMiBMax": 30.891517639160156,
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
    "elapsedSeconds": 60.841565875,
    "physicalFootprintBytesP95": "32392104",
    "physicalFootprintBytesMax": "32392104",
    "physicalFootprintMiBP95": 30.891517639160156,
    "physicalFootprintMiBMax": 30.891517639160156,
    "packageIdleWakeups": 0,
    "interruptWakeups": 1,
    "totalWakeups": 1,
    "wakeupsPerMinute": 0.9861679122998082,
    "diskReadBytes": 0,
    "diskWrittenBytes": 0
  },
  "budgetEvaluation": {
    "staticCpuP95WithinCeiling": true,
    "staticRssMaxWithinCeiling": false,
    "staticPhysicalFootprintP95WithinCeiling": true,
    "staticWakeupsWithinCeiling": true,
    "networkEndpointsObserved": 0
  },
  "measurementCoverage": {
    "cpu": "partial",
    "rss": "partial",
    "physicalFootprint": "partial",
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
  "wakeupsPerMinute": 0.9861679122998082,
  "decoderSessions": null,
  "qualification": "partial-static-smoke-only"
}
```

## Result

The sampled physical-footprint P95 and maximum were both 30.8916 MiB, inside
the new separate 40 MiB P95 ceiling. CPU was 0.0%, one interrupt wakeup occurred
over 60.842 seconds, process-attributable disk deltas were zero, and no open
network endpoint was observed. Those short-window observations are not
qualifying contract-P95 or endurance claims.

RSS P95 and maximum were 85.23 MiB, above the unchanged 40 MiB RSS ceiling. The
ceiling is not weakened, and the physical-footprint result does not override
that failure. Only one 1920×1080@120 Hz display was online, so the required
3008×1692@240 Hz plus 2560×1440@60 Hz fixture was not present.

Physical-footprint coverage advances only to `partial`. Decoder/GPU activity,
frame pacing, pressure/failure behavior, the representative 1,000-item catalog,
the exact dual-display fixture, release-candidate provenance, and the 48-hour
soak remain unmeasured or incomplete. Issue #28 therefore remains open and the
canonical tracker remains schema v3 at 20/100.
