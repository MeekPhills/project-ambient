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

## Explicitly incomplete

This slice does not yet signpost import, thumbnail generation, wallpaper apply,
transition, video, chat, or shutdown spans. It does not establish P95 wakeup
conformance, dual-display fixture coverage, decoder/GPU or frame-pacing
evidence, pressure behavior, endurance, M4 certification, or tracker credit.
