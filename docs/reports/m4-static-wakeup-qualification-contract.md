# Base-M4 settled-static wakeup qualification contract

- **Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)
- **Contract ID:** `base-m4-static-settled-hidden-wakeups-v1`
- **Status:** plan only; no qualification evidence collected
- **Coverage:** wakeups remain `unmeasured`
- **Tracker:** canonical schema v3 remains 20/100

## Purpose and claim boundary

This document freezes the smallest repeatable protocol that can qualify one
Base-M4 wakeup scenario: Ambient settled in Static mode with every Ambient
window and popover hidden. It does not qualify app-open, paused, apply,
transition, reconnect, video, pressure, or soak behavior, and it does not alter
the existing two-wakeup-per-minute ceiling.

No run has been performed under this contract. No result, Base-M4
certification, milestone completion, or tracker credit follows from publishing
the plan. Issue #28 remains open, and the canonical tracker remains schema v3
at 20/100.

## Frozen trial protocol

The qualifying set contains exactly five predeclared trials. Every trial must:

1. Launch a fresh instance of the same exact release-candidate artifact.
2. Run natively as `arm64`, without
   `--wakeup-attribution-signposts` or another diagnostic argument.
3. Preserve one process incarnation and the exact candidate executable from
   the pre-warm-up check through the final measurement check.
4. Complete a separate 300-second warm-up in the bound settled-static scenario.
5. Complete one 900-second, signposts-off measurement window with 901 snapshots
   on absolute one-second monotonic deadlines. The snapshots define 900
   intervals; the collector must not accumulate sequential `sleep 1` drift.
6. Preserve the candidate, machine, display topology, power policy, media, app
   state, and window-visibility fixture for the entire warm-up and measurement
   window.

The later collector must retain the existing fail-closed timing guards: every
snapshot gap must be between 0.5 and 2.0 seconds, paired clocks must stay within
100 milliseconds, and the measurement span must be between 900 and 905
seconds. A process restart, counter regression, missing or extra snapshot,
timing violation, fixture drift, or incomplete attestation makes that trial
invalid.

After the temporary rows are deleted, each sanitized window retains the
observed minimum and maximum sampling gaps, maximum absolute cross-clock drift,
fresh-process and warm-up completion flags, process/candidate continuity, and
fixture/scenario stability. Those closed fields make eligibility reviewable;
`eligible` must be true if and only if every retained proof flag is true. It
cannot be suppressed to hide a valid high-wakeup trial or asserted to replace
missing or out-of-range proof.

One invalid, missing, duplicate, reordered, replaced, or extra trial makes the
whole five-trial set incomplete. A high valid trial remains in the set. There
is no best-five selection, replacement run, retry that erases an accepted
result, pooling of per-second zeroes, or post-collection change to the trial
count.

## Wakeup calculation and decision rule

For each valid window, use only the process interrupt-wakeup counter delta.
Package-idle wakeups are a diagnostic subset and must be validated as such;
they are never added to interrupt wakeups.

Normalize every window against the fixed fifteen-minute measurement duration:

```text
normalized wakeups per minute = interrupt wakeup delta / 15
```

Do not divide by a delayed window's longer observed elapsed time to lower its
rate. Sort the five normalized rates in ascending order and apply nearest-rank
P95 with one-based indexing:

```text
ceil(0.95 * 5) = 5
```

Rank five is therefore the maximum observed window rate. The scenario conforms
only when all five trials are valid and that P95 is at most the unchanged
ceiling of 2 wakeups per minute. A complete measured set above the ceiling is a
valid failure, not an incomplete result. An incomplete set keeps P95 and
contract conformance null. After a future plan freezes the required still, its
accepted windows may be labeled `partial` only when the result-level fixture
and scenario proof is also complete. The current null-still plan cannot retain
any window: its active incomplete form requires zero accepted windows,
`unmeasured` scenario/global coverage, and reason `missing-attestation`. A
complete sanitized result reports all five window aggregates, their median and
range, and the rank-five P95; it never substitutes a single best run.

## Exact candidate and fixture binding

All five trials must bind to one reviewed release candidate through its source
revision, version, release-manifest SHA-256, macOS archive SHA-256, executable
SHA-256, `arm64` architecture, release configuration, and artifact kind. The
running executable must match that candidate before and after every trial. A
different executable digest, including a later signed or notarized binary,
requires a new five-trial set.

Every retained result must also name the exact producer revision and SHA-256
of the qualification-plan bytes it follows. Its fixed-still digest must equal
the digest frozen in that exact plan. The current plan deliberately carries a
null digest, so the published schema accepts plan artifacts while its only
active result branch accepts plan-bound incomplete results; the validator pins
the reviewed plan bytes exactly. The complete-result definition is reserved
for synthetic contract testing and is not an active evidence branch.
Activating complete results requires a reviewed plan revision and byte digest
that freeze the non-personal still first.

The retained result also records the non-identifying macOS version and build.
Both must remain stable across all five trials; a system update or build drift
makes the set incomplete.

The hardware and display fixture is fixed to:

- Apple M4 Mac mini, 2024 base configuration: 10-core CPU, 10-core GPU, 16 GB
  unified memory, and 256 GB storage;
- AC power, Low Power Mode off, Minimal/efficiency policy, and nominal thermal
  state;
- two awake, non-mirrored displays with HDR off;
- 3008x1692 HiDPI at 240 Hz and 2560x1440 HiDPI at 60 Hz; and
- unchanged display modes and topology across every warm-up and measurement
  window.

The scenario is also fixed:

- Ambient is in Static mode with playback status `playing` and the
  screen-lock rotation trigger;
- one predeclared, non-personal SDR still is applied to both displays,
  identified by an immutable SHA-256 digest;
- no enabled rule, temporary channel activation, timed pause, import, scan,
  apply, transition, or other in-flight work exists;
- the main window, Settings window, import sheet, and menu-bar popover are all
  hidden;
- the user session remains unlocked and the displays remain awake;
- no user interaction, sleep/wake, lock, display reconfiguration, power-policy
  change, clock or time-zone change, or Ambient state mutation occurs; and
- no other wallpaper or display controller, debugger, profiler, log capture,
  or diagnostic session is active.

The fixed non-personal still and its reviewed digest do not yet exist in the
repository. They are prerequisites for evidence collection; arbitrary or
personal media cannot substitute for them.

## Automated checks and owner attestation

The future collector and public-API preflight must automate every fact that can
be checked safely and deterministically. Owner attestation is limited to facts
for which this contract has no reviewed, non-identifying public probe.

| Requirement | Enforcement before a result is eligible |
| --- | --- |
| Candidate source, clean release build, manifest/archive/executable hashes | Automated |
| Running executable match before and after each trial | Automated |
| Native `arm64`, executable identity, prohibited-argument absence, and process-incarnation continuity | Automated with public APIs |
| Warm-up duration, absolute-deadline cadence, snapshot count, clocks, counter monotonicity, normalization, rank, and P95 | Automated |
| Publicly exposed non-identifying model, chip, CPU/memory, macOS version/build, and stable machine facts | Automated where public APIs provide closed facts |
| Exact display count, HiDPI modes, refresh rates, awake/non-mirrored state, and pre/post topology stability | Automated with public CoreGraphics APIs |
| Factory base 10-CPU/10-GPU/16-GB/256-GB configuration, including exact GPU/storage SKU facts unavailable through a reviewed public probe | Owner-attested; any available automated mismatch overrides |
| HDR off | Owner-attested unless a reviewed closed public probe is available |
| Fixed still applied to both displays | Automated only if a reviewed app-owned closed probe exists; otherwise owner-attested |
| Ambient settled, all windows/popovers hidden, and no in-flight UI work | Owner-attested for this smallest contract |
| No interaction, transition, competing controller, profiler, log capture, or prohibited diagnostic | Owner-attested, with automated pre/post stability checks where available |

Owner attestation never overrides an automated mismatch, repairs missing data,
or makes an invalid trial eligible. If an automated requirement cannot be
verified, collection stops incomplete.

## Tooling and privacy boundary

The strict collector and purpose-built preflight are later prerequisites. They
must use documented public APIs and fixed protocol constants: callers may not
change the warm-up, duration, cadence, repeat count, percentile method, rank,
or ceiling. They must not use private Apple SPI, elevation, a privileged
helper, EDID or I/O Registry inspection, a profiler, System Trace, unified-log
queries or streams, or another raw diagnostic capture.

Temporary raw rows may exist only in an auto-deleted local scratch location
for cadence, counter, and process-continuity validation. Any minimum ephemeral
process ID, process-start token, or timestamp needed for those checks stays in
that scratch data. Raw rows must never be committed or retained as the
qualification result. The retained artifact must exclude process IDs,
process-start tokens, absolute timestamps or timestamp streams, paths,
filenames, usernames, host or boot UUIDs, hardware and display serials, display
IDs, vendor/product IDs, EDID, registry IDs, environment data, logs, personal
media, prompts, credentials, and precise location. It may retain only the
closed candidate digests and version, macOS version/build, fixture and scenario
booleans, sanitized timing/counter aggregates, and the final qualification
state required by this contract.

## Ineligible historical and exploratory inputs

The existing flexible `script/measure_m4_wakeup_series.sh` collector and every
301-sample [wakeup-series observation](m4-wakeup-attribution-observation.md) are
diagnostic evidence only. They lack the separate warm-up, 900-second window,
901 absolute-deadline snapshots, exact release-candidate binding, complete
dual-display fixture, and settled-state/window-visibility attestation required
here. Their caller-configurable duration and cadence also make their outputs
structurally ineligible for direct qualification.

The exploratory 301-sample signposts-off window and the earlier signposts-on
instrumented smoke must not be imported, migrated, averaged, or cited as a
trial under this contract. A favorable short window cannot become qualifying
evidence after collection.

## Contract validation

`node script/validate_m4_static_wakeup_qualification.mjs` pins the exact schema,
plan, and bound resource-fixture bytes; validates the current and synthetic
collection-ready plans, conforming and nonconforming complete results, the
current zero-window incomplete result, and a collection-ready partial result;
and rejects 101 schema, plan-binding, eligibility, protocol, arithmetic,
identity, fixture, privacy, and claim tamper cases. The current-plan incomplete
result is unmeasured; the separate synthetic partial result exercises retained
global-proof requirements. The command accepts no result path, runs no host
probe, and collects no evidence.

## Prerequisites and next action

Before any qualifying collection begins, a separate reviewed slice must add:

- a strict collector/orchestrator that enforces this fixed five-trial protocol,
  uses absolute monotonic deadlines, retains raw rows only temporarily, and
  emits a closed sanitized result;
- a purpose-built public-API preflight for candidate identity, native
  architecture, prohibited-argument absence, non-identifying machine facts,
  and exact display topology; and
- the fixed non-personal SDR still plus its immutable reviewed digest.

Those tools must be synthetically tested against timing, arithmetic, identity,
fixture, privacy, and tamper failures before they collect host evidence. Until
all prerequisites exist and a complete five-trial set passes review, wakeups
remain `unmeasured`, issue #28 remains open, and the canonical tracker remains
20/100 on schema v3.
