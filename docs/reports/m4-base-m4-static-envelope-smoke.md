# Base-M4 static-envelope smoke

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Captured:** 2026-08-22T13:16:37Z
**Qualification:** partial static smoke only — no tracker credit or M4 certification

## Scope

This is a repeatable, public-tool observation of one already-running Ambient
process while it was settled in the current Static implementation. It does not
exercise media import, an active transition, video, chat, the 1,000-item
catalog, the required dual-display fixture, or any failure path. It contains no
filenames, paths, media content, prompts, credentials, or location data.

The reference host was identified as an Apple M4 Mac mini with 16 GB unified
memory. The required 256 GB storage verification and display fixture remain
separate acceptance evidence.

## Reproduction

From a checkout at the candidate revision, with Ambient already running and
settled in Static mode:

```bash
pid="$(pgrep -x Ambient)"
./script/measure_m4_static_smoke.sh "$pid" 60 1
```

The harness samples `ps` CPU and RSS once per second, counts currently open
network endpoints with `lsof` when available, and emits JSON. It deliberately
emits `null` for metrics it cannot truthfully obtain with those public tools.
It exits nonzero if the process disappears during capture.

## Captured result

```json
{
  "pid": 48286,
  "capturedAt": "2026-08-22T13:16:37Z",
  "samples": 60,
  "intervalSeconds": 1,
  "cpuPercentP95": 0.0,
  "cpuPercentMax": 0.0,
  "rssMiBP95": 7.95,
  "rssMiBMax": 7.95,
  "openNetworkEndpoints": 0,
  "wakeupsPerMinute": null,
  "decoderSessions": null,
  "qualification": "partial-static-smoke-only"
}
```

| Budget row | Observation | Status |
| --- | --- | --- |
| Settled controller CPU P95 <= 0.2% | 0.0% during this 60-second sample | Observed, not certified |
| Settled controller RSS P95 <= 40 MiB | 7.95 MiB during this 60-second sample | Observed, not certified |
| No open network endpoint while sampled | 0 endpoints from `lsof -i` | Observed only; this is not traffic capture |
| Wakeups <= 2/minute | Not measured | Unmeasured |
| No decoder or continuous renderer | Decoder count not measured | Unmeasured |
| GPU, frame pacing, storage churn | Not measured | Unmeasured |
| 1,000-item UI, 8K dual-display, pressure, reconnect | Not exercised | Unmeasured |
| 48-72 hour clean-machine soak | Not started | Unmeasured |

## Interpretation and next action

The result is evidence that the sampled Static process was within the CPU and
RSS ceilings for one short settled interval. It is not evidence that Ambient
has no timer/listener activity, that it used no decoder, that it sent no network
traffic, or that it meets any unmeasured row. No resource-budget schema,
fixture, or M4 score is activated by this report.

Next, add a versioned fixture and a public-tool collection path for wakeups,
decoder/GPU and display topology; then run the required dual-display, pressure,
failure, and 48-72 hour clean-machine matrix before requesting M4 credit.
