# Base-M4 opt-in wakeup signpost contract

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
**Status:** implementation and correlation aid only; no qualification
**Platform:** macOS 14 or later

## Runtime contract

Ambient emits wakeup-attribution signposts only when launched with the exact
`--wakeup-attribution-signposts` argument. Without that argument, the injected
sink is a no-op and no `OSSignposter` is constructed. This slice adds no timer,
polling loop, file, persistence field, network request, logger mirror, or raw
trace capture.

The signposter uses subsystem `io.projectambient.mac`, category
`WakeupAttribution.v1`, and exactly these static event names:

1. `lifecycle.launch`
2. `lifecycle.will_sleep`
3. `lifecycle.did_wake`
4. `lifecycle.screen_locked`
5. `lifecycle.screen_unlocked`
6. `display.configuration_changed`
7. `power.state_changed`
8. `clock_or_timezone.changed`
9. `state.local_changed`
10. `state.external_changed`
11. `rotation.boundary_fired`

Each event is emitted at the semantic coordinator entry point, before state,
generation, sleep, wake-burst, lock-cycle, or revision guards. An ignored
duplicate can still be the callback that woke the process and must remain
visible for correlation.

## Prohibited payloads

The signposts carry no message or interpolation payload. They contain no date,
duration, revision, boundary reason, display count, power value, error, path,
filename, object/request/channel/asset identifier, media, prompt, credential,
location, or generated signpost ID. Only the fixed subsystem, category, event
name, and OS-provided local timing/process metadata exist in the unified log.
No raw unified-log archive is an accepted repository artifact.

## Correlation protocol

An attribution run must be explicitly opted in, confirm that
`lifecycle.launch` is retrievable, warm up, and then run the bounded public
process-rusage series. Query only this subsystem/category after the sampling
window; do not attach Instruments or run a live log stream during the budget
window. Sanitize immediately to the fixed event name and an offset relative to
the window start, discard the raw query output, and record whether the bounded
query reported loss.

Use matched signposts-on and signposts-off windows. Instrumented windows may
help identify candidate callbacks; only signposts-off windows can contribute to
the actual wakeup budget. A signpost in the same or adjacent one-second bucket
shows that its handler ran in that interval, not that it caused the wakeup.
Repeated alignment still requires controlled suppression and uninstrumented
replication before causal attribution. No nearby signpost excludes only these
instrumented seams; it does not prove a framework or kernel source.

## Fail-closed sanitizer

The only supported production query path is:

```bash
node script/sanitize_m4_wakeup_signposts.mjs \
  --series /path/to/signposts-on-wakeup-series.json \
  --query-start 2026-08-23T10:45:00Z \
  > /path/to/signposts-on-correlation.json
```

The series must be the exact, complete JSON object emitted by
`measure_m4_wakeup_series.sh`. The query start is a required whole-second UTC
timestamp before the measurement start, with at most one hour of lookback. The
sanitizer validates the fixture identity, process ID, requested and observed
sample counts, wall/monotonic window agreement, complete activity buckets,
counter sums, wakeup rate, coverage, and non-qualification fields before it
queries any logs. Correlation accepts only the collector's exact one-second
sampling interval and at most 256 complete activity rows; a wider sampling
interval cannot support the documented same/adjacent-second semantics.

The Node process invokes `/usr/bin/log show` directly without a shell, raw-log
path, archive, output option, or live stream. The query is bounded by the
declared start and series completion, includes loss records, and selects all
signpost events for the measured PID and fixed subsystem/category without
filtering by event name. Raw NDJSON remains in the child pipe and transient
memory only. Nothing is written to standard output until the child exits and
the entire query validates.

Validation rejects without producing an artifact when any of these conditions
is observed:

- malformed, incomplete, oversized, or non-terminal NDJSON;
- any unified-log loss record or unsuccessful query exit;
- an unknown event name, wrong PID/subsystem/category/type, interval signpost,
  or message/format payload;
- a missing, duplicate, or in-window `lifecycle.launch` marker;
- a malformed, timezone-free, impossible, out-of-query, or out-of-window
  timestamp;
- a query lookback over one hour, a measurement over the bounded 72-hour
  protocol, or wall/monotonic window drift over two seconds;
- a missing/additional series field, truncated activity list, inconsistent
  count/sum/rate, unsafe number, changed fixture ceiling, conformance claim, or
  qualification claim.

The parser accepts at most 256 selected records, 64 KiB per NDJSON line, and
4 MiB of child output. Its release self-test uses synthetic in-memory records;
the repository contains no raw or raw-shaped unified-log fixture.

The retained version-1 artifact contains only the measurement window, fixed
query identifiers, grouped `(eventName, offsetSecond, count)` rows, wakeup
buckets with same/adjacent groups, aggregate counts, and explicit null
causation/qualification. It does not retain raw timestamps, messages, paths,
UUIDs, process or sender images, thread/activity/signpost identifiers, host or
boot identity, disk counters, ceiling comparisons, or source qualification.
The artifact is always marked
`budgetEligibility: "ineligible-signposts-on-window"`.

For correlation, an activity row with interrupt wakeups is treated as a bucket
ending at its `offsetSeconds`. Static signposts in the floored same second or
one adjacent second are listed as `same`, `adjacent-before`, or
`adjacent-after`. Disk-only activity rows are not wakeup buckets. A nearby row
means only that the named handler executed nearby; an empty list means only
that no instrumented handler was observed nearby.

### Runtime compatibility smoke

On 2026-08-23, the production CLI completed a six-snapshot, one-second-interval
smoke against a deliberately instrumented Ambient launch. It retrieved exactly
one pre-window launch marker, observed no unified-log loss, retained no
in-window signposts, and emitted three wakeup buckets containing four interrupt
wakeups with no nearby instrumented callback. Raw NDJSON remained in the child
pipe, the temporary process series was deleted, and no correlation artifact was
written to the repository or filesystem. This proves parser/query compatibility only. The short
signposts-on window is ineligible for budget, cadence, P95, attribution, or
qualification claims.

## Explicitly incomplete

This slice does not yet signpost import, thumbnail generation, wallpaper apply,
transition, video, chat, or shutdown spans. It does not establish P95 wakeup
conformance, dual-display fixture coverage, decoder/GPU or frame-pacing
evidence, pressure behavior, endurance, M4 certification, or tracker credit.
