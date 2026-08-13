# Project Ambient — Claude Code Operating Guide

Project Ambient is a local-first ambient desktop platform. It must be simple enough for a first-time user to install and choose a static background in minutes, powerful enough to automate live/contextual scenes, and governable enough for managed fleets.

## Start here

1. Read this file completely.
2. Read `docs/handoffs/CURRENT.md`.
3. Read `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`.
4. Open the GitHub milestone and issue named in the handoff.
5. Confirm the issue dependencies are closed or explicitly waived.
6. Inspect the current branch and working tree. Preserve user changes.
7. Run the baseline verification commands below before editing.
8. Work only on the issue's acceptance criteria.
9. Before stopping, update the handoff and post evidence to the GitHub issue.

GitHub is the source of truth for milestones, status, dependencies, acceptance criteria, and release gates. This repository is the source of truth for architecture, decisions, commands, and the current technical handoff. Conversation history is not a dependency.

## Product modes

The UI progressively discloses three modes. They share one library, policy engine, renderer protocol, and state model.

- **Static** — guided local photo selection and lock/wake rotation with near-zero idle cost.
- **Hybrid** — scheduled/contextual photos, videos, live feeds, sunrise/sunset, continuity across displays, adaptive quality, and automatic fallbacks.
- **Managed** — fleet policy, shared content, approvals, auditability, licensing, privacy controls, and support.

Never expose these as three unrelated products. Onboarding starts in Static; users unlock Hybrid and Managed capabilities without rebuilding their library.

## Compatibility contract

- macOS is the reference implementation and must include every Aerial capability that the OS and licensing permit before public GA.
- Windows and Linux receive capability-equivalent desktop behavior, with native adapters where wallpaper APIs differ.
- iOS/iPadOS and Android are companion or OS-integrated experiences where continuous third-party wallpaper rendering is restricted. Never claim impossible parity.
- Legacy builds are published only for OS versions with measurable active demand or vendor support. Archived builds remain downloadable with an explicit support/security status.
- Unsupported platform behavior must be shown as unavailable with the exact reason; never silently degrade or guess.

## Architecture boundaries

Keep these layers separable and testable:

1. Library/catalog and non-destructive imports
2. Scene/channel/rule model
3. Decision and scheduling engine
4. Preparation, quality scoring, and cache
5. Platform renderer adapters
6. Verification, recovery, and last-known-good state
7. Optional sync/remote control
8. Managed policy and licensing

The orchestration state remains:

`idle → deciding → preparing → applying → verifying → active`

Any failed transition restores last-known-good media or a safe static fallback. Live feeds are never the only playable source.

## Privacy, safety, and media rules

- Local-first and no account required for core use.
- Do not move or delete source media. Imports copy or reference originals based on an explicit user choice.
- Never upload personal media, precise location, filenames, or usage history without explicit opt-in.
- Telemetry is off by default. Compatibility and performance diagnostics are opt-in, minimized, documented, and inspectable.
- No secrets, tokens, signing material, personal media, generated caches, or machine-specific absolute paths in commits.
- Network sources require provenance, license metadata, retry limits, caching policy, and a static fallback.
- All remote commands pass through the same policy/verification path as local commands.

## Branch and issue discipline

- One issue outcome per branch.
- Branch names: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`, or `chore/<issue>-<slug>`.
- Do not push directly to `main`.
- Do not mix opportunistic refactors with feature work.
- Every PR links its issue and milestone, states platform scope, lists verification evidence, and updates documentation.
- If scope expands, update or split the GitHub issue before implementing.
- Use issue comments for durable progress checkpoints; do not depend on chat history.

## Verification baseline

Run the commands that exist on the branch. If a command is unavailable, record that exact fact in the issue and handoff.

For a clean full baseline, install the locked JavaScript dependencies and run the repository aggregate verifier:

```bash
npm --prefix services/mcp ci
npm --prefix apps/site ci
./script/verify_release.sh
```

Use these focused commands while working in one subsystem:

```bash
swift build --package-path apps/macos
swift test --package-path apps/macos
npm --prefix services/mcp run check
npm --prefix services/mcp test
npm --prefix apps/site run build
npm --prefix apps/site test
```

`./script/build_and_run.sh --stage` builds the macOS app bundle without launching it. `./script/build_and_run.sh --verify` launches the app and verifies its process, so reserve that command for an authorized GUI smoke test.

Also run the smallest relevant platform/UI/performance checks specified by the issue. Performance-sensitive work must report a before/after measurement on the same hardware and content. Rendering claims require verification on every affected display orientation and scale.

## Definition of done

An issue is done only when:

- every acceptance criterion is checked with evidence;
- tests and relevant static analysis pass;
- failure, offline, and fallback behavior are covered;
- accessibility and keyboard behavior are covered for UI work;
- CPU, GPU, memory, network, and storage impact are measured when relevant;
- user-facing documentation and compatibility data are updated;
- the current handoff points to the next unblocked issue;
- the PR is reviewable and contains no unrelated changes.

## End-of-session handoff

Before credits or context run low, stop starting new work and update `docs/handoffs/CURRENT.md` with:

- milestone and issue;
- branch, commit, and PR;
- completed acceptance criteria;
- files changed;
- commands run and exact results;
- decisions and assumptions;
- blockers and risks;
- next exact action;
- rollback or recovery notes.

Post the same concise checkpoint to the GitHub issue. Leave the repository buildable. If unfinished code cannot be made safe, revert only your own unfinished changes or clearly mark a draft PR; never discard another person's work.

## Release gate

Public GA is blocked until:

- the Aerial parity matrix is complete on macOS or an item has a documented legal/OS exception;
- Static, Hybrid, and Managed paths pass their launch acceptance suites;
- Windows/Linux support claims match tested capability manifests;
- mobile claims match actual OS APIs;
- update, signing, notarization/package verification, rollback, accessibility, privacy, offline, multi-display, and energy tests pass;
- support status is published for every downloadable build.
