# Full Platform Launch Design

**Status:** Accepted for M0 planning; product implementation remains gated

**Date:** 2026-08-13
**Decision owner:** Project Ambient maintainers  
**Tracking:** GitHub milestones and issues  
**Reference platform:** macOS

The six launch-boundary decisions were accepted on 2026-08-13 in [decision record 0001](../decisions/0001-m0-launch-boundaries.md). This approval authorizes task decomposition and validation, not unrestricted implementation.

## 1. Outcome

Project Ambient launches as one progressively disclosed product with three operating modes:

1. **Static** — the default path: local high-quality photos, multi-display layouts, and event-driven rotation with near-zero idle CPU.
2. **Hybrid** — context-aware photos, local video, live feeds, schedules, sunrise/sunset, adaptive quality, and deterministic fallback.
3. **Managed** — shared libraries, policy, licensing, deployment, audit, and fleet controls.

The public launch must include the full useful feature surface of Aerial on macOS while differentiating through first-class still photos, explainable decisions, measurable energy budgets, robust multi-display state, graceful degradation, and managed deployment. Windows and Linux provide capability-equivalent desktop behavior. Mobile products expose the maximum behavior permitted by their operating systems without claiming false continuous-wallpaper parity.

## 2. Design principles

- First success in under three minutes: install, choose a folder or starter scene, preview both displays, apply.
- Static-first. Motion and network sources are optional upgrades, never prerequisites.
- One canonical scene state across wallpaper, lock/screen-saver, displays, and remote clients.
- Every automatic decision answers **Now / Next / Why**.
- Every live source has a cached or local still fallback.
- Source media is never moved or deleted by default.
- CPU/GPU/network/storage are governed by a user-visible budget, not hidden heuristics.
- Capabilities are declared and tested per platform; unavailable behavior explains why.
- Core use is local and account-free.
- The project is reproducible: release source, tag, binary, manifest, and checksums agree.

## 3. User experience

### 3.1 Guided setup

The installer offers the native package for the detected OS. On first launch:

1. **Choose a starting mode.** Static is recommended; Hybrid and Managed are explained in one sentence.
2. **Choose content.** Use a starter pack, select folders, connect Photos/system libraries where permitted, or import videos. Originals remain untouched.
3. **Map displays.** A visual canvas shows each display, orientation, resolution, scale, crop, and role.
4. **Choose continuity.** Same image, synchronized sequence, panorama span, or independent scenes.
5. **Choose change events.** Default is change after lock/unlock; alternatives include schedule, context, or manual only.
6. **Choose energy budget.** Minimal, Balanced, or Showcase with an inspectable custom policy.
7. **Preview and apply.** The app verifies every display, saves last-known-good state, and reports exact exceptions.

The user lands on Home, not a settings maze.

### 3.2 Primary navigation

- **Home:** Now / Next / Why, display previews, energy status, pause, repair, restore.
- **Library:** photos, videos, live feeds, packs, favorites, hidden, downloaded, duplicates, rights.
- **Scenes:** reusable presentation definitions.
- **Automations:** event, time, location, weather, solar, app, power, and remote rules.
- **Displays:** topology, same/sync/span/independent behavior, per-display crop and fallback.
- **Health:** resource use, source health, cache, diagnostics, release/support status.
- **Settings:** platform integration, privacy, updates, integrations, managed policy.

Advanced controls appear only when their mode is enabled.

## 4. Aerial parity contract for macOS

Every row requires an automated or documented manual launch test. A legal or OS exception must be explicit; omission is not an exception.

| Capability group | Required Project Ambient behavior |
|---|---|
| Install/update | Signed/notarized app, website download, package manager path where practical, automatic updates with signature verification, stable/beta channels, rollback |
| Screen saver/lock | Platform-supported screen-saver or lock experience, transitions, filters, overlays, consistent scene state and recovery |
| Wallpaper | Static and live wallpaper modes, native OS integration where available, verified resume after login/sleep/display reconnect |
| Fullscreen | On-demand fullscreen preview/playback |
| Apple content | Optional discovery/cache of legally usable system/Apple content without redistributing restricted media |
| Personal media | First-class photos plus MOV/MP4 and supported codecs; copy or reference choice; recursive folders; collision and duplicate handling |
| Playlists/channels | Named, ordered, import/export, direct play, loop, shuffle, no-repeat shuffle, fallback channel |
| Filters | Source, location, scene, time, favorites, hidden, download state, tags, quality, orientation, energy tier, rights |
| Live feeds | HLS, progressive MP4, RTSP/RTSPS through isolated helper, YouTube Live through optional helper, credentials in secure storage, health checks and fallback |
| Content packs | Curated opt-in packs, independent licenses/attribution, update/remove, creator manifest and validation |
| Displays | Independent, same/cloned, synchronized sequence, spanned panorama, mirrored/flip where useful, vertical and irregular layouts, manual margins |
| Time/solar | Manual or approximate location, sunrise/sunset, light/dark, time windows, Night Shift/system appearance integration where available |
| Energy/lifecycle | Window coverage threshold, per-app ignore rules, battery/low battery, Low Power Mode, thermal pressure, camera use, auto-advance while motion is paused, visible pause reason |
| Transitions | Cut, crossfade, dip to black, zoom fade with reduced-motion alternatives |
| Overlays | Clock, weather, music, battery, text, timer, editable zones, per-display placement, accessibility and clipping tests |
| Cache | Budget/limit, replacement cadence, trusted network policy, download state, external location where supported, integrity and churn protection |
| Privacy | No telemetry by default, manual location, inspectable network domains, explicit integration consent, local settings export/delete |
| Diagnostics | Export redacted diagnostics, logs, source health, state reconciliation, safe reset, repair, last-known-good restore |
| Playback details | Hardware decode, audio off by default, explicit audio policy, speed controls where viable, quality profiles, skip broken items |

Parity does not mean copying Aerial’s implementation or information architecture. It means users do not lose a capability when choosing Project Ambient on macOS.

## 5. Differentiating capability

### 5.1 First-class static media

Photos are native sources, not video workarounds. Catalog records include content hash, dimensions, color profile, orientation, crop-safe regions, capture time, location (optional), provenance, license, quality score, duplicate group, and display suitability. Applying a static scene leaves no continuous renderer running.

### 5.2 Explainable rule engine

A decision records inputs, matched rules, rejected candidates, chosen scene, fallback, resource estimate, next reevaluation, and user-readable explanation. The engine supports deterministic replay for tests.

### 5.3 Energy budget and degradation ladder

A policy establishes ceilings or goals for CPU, GPU, memory, network, storage churn, and frame delivery. The runtime moves through:

1. requested live quality;
2. reduced frame rate/scale/codec profile;
3. locally cached loop;
4. motion paused on a high-quality frame;
5. optimized static image;
6. last-known-good safe background.

Upgrades use hysteresis so the desktop does not oscillate. Frame pacing, dropped frames, decode latency, and energy impact are reviewed automatically. A scene is quarantined if it repeatedly misses its quality contract.

### 5.4 Multi-display canonical state

The topology model uses stable identities plus reconciliation for changed UUIDs, ports, orientation, scale, and sleep/reconnect. One transaction prepares all display outputs and commits them together. The user can choose same image, synchronized sequence, panorama span, or independence. Failure on one display must not silently corrupt another.

### 5.5 Event-driven rotation

Rules may evaluate continuously, but heavy work is deferred to safe events. The minimal preset changes the background only after lock/unlock, login, display topology change, or explicit action. Content preparation can run while locked, then apply atomically before or at unlock. A user may require “never change while I am actively logged in.”

### 5.6 Solar and live scenes

Solar scenes calculate sunrise/sunset from user-approved location or a named city such as Washington, DC. They can use a matching local timelapse, cached feed, or live source. The timeline stretches or selects frames to match the local solar window. Any stale, low-frame-rate, or unavailable source falls back to a high-quality static scene and reports why.

## 6. Cross-platform design

The shared core owns catalog, scenes, rules, decision logs, energy policy, sync protocol, manifests, and diagnostics. Platform adapters own wallpaper APIs, screen-saver/lock integration, display topology, media decode, secure storage, startup, notifications, and package/update behavior.

Swift remains the macOS reference implementation. Language-neutral schemas and behavioral fixtures define portable contracts. A bounded Rust feasibility spike occurs before M5; no rewrite proceeds without measured benefit and an incremental migration path.

| Platform | Launch contract |
|---|---|
| macOS | Reference desktop; full parity matrix; native Swift/SwiftUI adapter; supported macOS wallpaper/screen-saver APIs |
| Windows | Static/live desktop adapter, multi-monitor topology, startup, power/session events, package and signed updates |
| Linux | GNOME Wayland and KDE Plasma Wayland first; X11 best-effort legacy unless evidence promotes it; exact capability manifest by desktop environment/session |
| iOS/iPadOS | Library curation, scene/rule editing, sync/remote control, widgets/Shortcuts/App Intents and OS-permitted wallpaper actions |
| Android | Companion plus OS-permitted live wallpaper service where viable, power-aware defaults, device capability checks |

Shared business logic may be portable, but native integration is not forced into a lowest-common-denominator UI. Accessibility and platform conventions remain native.

## 7. Compatibility and archive policy

- Support current vendor-supported desktop releases first.
- Add older OS artifacts only when download counts, opt-in compatibility survey, issues, enterprise demand, or maintained CI runners show material use.
- Each downloadable artifact declares minimum/maximum tested OS, architecture, release channel, support status, last security update, checksums, signature identity, and source commit.
- “Archived” means downloadable but not promised security fixes. It must never look current.
- No hidden telemetry is introduced to measure legacy demand.
- Release tags must reproduce the released source. CI verifies version, tag, manifest, checksums, signature, and published assets.

## 8. Managed and commercial direction

The MIT-licensed community core includes local Static and Hybrid foundations, policy visibility, local diagnostics, and documented extension points. It remains useful and account-free. Commercial value can live in hosted sync, team libraries, licensed content delivery, approvals, fleet policy, SSO/SCIM, audit retention, compliance controls, SLA support, and managed update rings.

Community GA may launch with a separately gated Managed Preview. That preview is not represented as enterprise GA; enterprise claims require preview evidence and the applicable identity, isolation, support, and compliance gates.

Media and software licenses are separate. Every pack/scene manifest carries provenance, attribution, permitted use, territory/term where applicable, and redistribution rules. Enterprise policy can prohibit unapproved domains or unlicensed media.

Creator pack manifests, local validation, installation, update, attribution, and removal ship in M2. Hosted transactions, payouts, and marketplace economics wait until the local library and M4 resilience contracts are stable.

Diagnostics are off by default, locally redacted, allowlisted, inspectable, and purpose-bound. They never include media, thumbnails, filenames, local paths, prompts, credentials, precise location, or unrelated application data. Hosted diagnostics default to 30-day retention with export and deletion.

## 9. Program milestones

Milestones have launch gates rather than invented dates.

### M0 — Program Governance & Agent Continuity

Claude Code operating guide, current handoff, issue/PR templates, decision log, capability manifest format, parity matrix, dependency map, support policy, and measurable definition of done.

### M1 — Guided Static Foundation

Three-minute onboarding, first-class photos, non-destructive library, quality/crop pipeline, Static mode, event-driven rotation, multi-display same/sync/span/independent, last-known-good restore, zero-renderer idle verification.

### M2 — Media Library & Content Ecosystem

Personal video, recursive sources, metadata, deduplication, playlists/channels, filters, import/export, local/system catalogs, packs, attribution/licensing, creator tooling, cache integrity.

### M3 — macOS Renderer & Aerial Feature Parity

Wallpaper, screen saver/lock integration, fullscreen, transitions, overlays, live feeds, helpers, time/solar behavior, all display modes, playback controls, diagnostics, signed updates, complete parity suite.

### M4 — Automation, Energy & Resilience

Explainable rules, all pause inputs, resource budgets, adaptive quality, auto-review/quarantine, offline fallback, live feed health, transactional display commits, sleep/wake/reconnect reconciliation, decision log.

### M5 — Windows & Linux Desktop

Shared-core boundary, Windows adapter/package, Linux capability matrix and initial DE adapters, platform-native lifecycle/security, parity-by-capability tests.

### M6 — Mobile Companions & OS Integrations

iOS/iPadOS and Android library/scene control, secure sync, remote commands, widgets/Shortcuts/App Intents, Android live wallpaper where viable, explicit OS limitation UX.

### M7 — Managed, Enterprise & Commercial

Organizations, shared libraries, approvals, fleet policy, SSO/SCIM, audit, licensing/entitlements, update rings, admin diagnostics, privacy/compliance and support operations.

### M8 — Public GA, Distribution & Compatibility Archive

Website/download flow, package managers/stores where viable, migration, release reproducibility, stable/beta channels, legacy evidence policy, compatibility archive, docs, community launch, support readiness.

## 10. GitHub execution model

Each milestone has one epic issue. Feature issues sit beneath an epic through links/checklists until native sub-issues are adopted. Each issue must contain:

- outcome and user value;
- modes and platforms;
- in-scope/non-goals;
- dependencies;
- acceptance criteria;
- verification commands and manual matrices;
- performance/privacy/accessibility requirements;
- docs/decision updates;
- Claude Code handoff instructions.

Progress is recorded in issue comments with branch, commit, tests, blockers, and next action. PRs close implementation issues; milestone epics close only when every launch gate has evidence.

### 10.1 Canonical progress model

`apps/site/app/status/status-manifest.json` is the only weighted completion tracker. The current 45/45/10 phase model and its historical 49.75/100 audit are preserved while M0 planning completes.

The provisional M0–M8 allocation of `8/14/12/20/14/12/7/6/7` is capacity guidance only and must not produce a second progress percentage. Issue #16 maps milestone gates to canonical task IDs and proposes a single versioned scope migration for expanded Windows, Linux, mobile, and Managed work. The migration must retain total weight 100, preserve historical evidence, give blocked and not-started work zero credit, and pass independent status/site validation.

## 11. Key decisions

- one product with progressive modes;
- capability-based cross-platform parity;
- macOS Aerial feature parity is a GA gate;
- static-first and local-first;
- mobile claims follow OS capabilities;
- evidence-based legacy support;
- GitHub is the program source of truth;
- Swift reference core plus language-neutral contracts and a pre-M5 Rust feasibility spike;
- MIT community core with separate hosted/managed commercial value and independent media rights;
- GNOME Wayland and KDE Plasma Wayland first, with X11 best-effort legacy;
- community GA with a separately gated Managed Preview;
- creator pack infrastructure in M2, hosted marketplace transactions after local and M4 reliability;
- opt-in, locally redacted diagnostics with prohibited sensitive fields and 30-day hosted retention.

The full rationale, consequences, and review triggers are in [decision record 0001](../decisions/0001-m0-launch-boundaries.md).

## 12. Approval gate

The maintainer accepted the six design decisions on 2026-08-13. This authorizes M0 planning and issue decomposition, not unrestricted product implementation.

1. #16 creates and validates the task-level dependency plan and canonical tracker migration.
2. #17 records the verified clean baseline and exact build/test/release commands.
3. The first vertical slice remains: install → import photo folder → map displays → static lock/unlock rotation → verify/restore.
4. Product implementation begins issue by issue only after the task plan is accepted, dependencies are satisfied, and capability flags/tests exist.
