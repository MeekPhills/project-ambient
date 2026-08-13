# Current Handoff

**Updated:** 2026-08-12  
**Program state:** Product design proposed; implementation not yet authorized by spec approval  
**Repository:** https://github.com/MeekPhills/project-ambient  
**Base branch:** `main`  
**Planning branch:** `plan/full-platform-launch`  
**Active pull request:** To be opened after planning files are complete  
**Current milestone:** M0 — Program Governance & Agent Continuity  
**Current issue:** To be assigned after GitHub milestones are created

## Read next

1. `CLAUDE.md`
2. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
3. Current M0 GitHub epic and its first unblocked child issue
4. Existing `ROADMAP.md`, `README.md`, and `docs/architecture.md`

## What was learned

- The repository already contains a macOS SwiftUI app, `ambientctl`, local orchestration, MCP services, release/distribution work, an Aerial video adapter, and remote-bridge hardening.
- Existing roadmap phases predate the new Static / Hybrid / Managed product model and the requirement that macOS public GA include Aerial’s full capability surface.
- Aerial 4.1 covers materially more than video playback: wallpaper and screen saver modes, playlists, filters, Apple/personal/Expansion/live sources, independent/cloned/spanned display behavior, solar/time rules, pause policies, transitions, overlays, cache controls, privacy posture, and diagnostics.
- Project Ambient’s defensible gap is first-class photos, explainable automation, a measurable energy budget, robust multi-display reconciliation, event-driven static operation, live fallback, and managed deployment.
- Cross-platform work must be capability-based. iOS/iPadOS cannot honestly promise the same continuous wallpaper behavior as desktop platforms.
- No GitHub milestones existed when this handoff was created. Only closed PRs were present; milestone/issue decomposition is the next program-control action.
- Local `gh` authentication was invalid. The signed-in GitHub web session and GitHub connector were available.

## Changes on the planning branch

- Added `CLAUDE.md` with the Claude Code pickup and end-of-session contract.
- Added `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md` with product modes, Aerial parity contract, architecture, platform policy, milestones, and open decisions.
- Added this handoff.

No product code was changed.

## Required next actions

1. Create GitHub milestones M0 through M8 exactly as specified in the launch design, without speculative due dates.
2. Create one epic issue per milestone and task-level M0 issues.
3. Link the planning PR to the M0 epic.
4. Review the design with the maintainer and record decisions on licensing, shared-core prototype scope, first Linux targets, Managed GA timing, marketplace timing, and opt-in diagnostics.
5. Only after design approval, produce the task-level implementation plan and update the existing roadmap.
6. Begin with the first vertical slice: install → import a photo folder without touching originals → map both displays → apply synchronized static scenes → rotate only at lock/unlock → verify and restore.

## Baseline repository facts

At handoff creation:

- Remote: `MeekPhills/project-ambient`
- Default branch: `main`
- Local checkout observed at `/Users/luismorrobel/Library/Mobile Documents/com~apple~CloudDocs/Codename Ambiant`
- Local branch observed: `harden/supabase-private-schema`
- That local branch contained commits associated with already-merged hardening PRs and must not be repurposed for planning.
- The working tree appeared clean, but verify before using it.
- Existing baseline commands documented by the project include `swift test`, `swift build`, and `./scripts/verify-release-integrity.sh`.

## Risks

- “Every Aerial feature at launch” is a large GA gate. Keep the parity matrix explicit so schedule pressure cannot silently remove features.
- Native wallpaper, lock, and screen-saver APIs differ by OS and OS version. Capability manifests and honest limitation UX are mandatory.
- Live feeds and overlays can erase the energy advantage. Static fallback and measured adaptive quality must be core architecture, not later polish.
- Display UUID/topology churn after sleep or reconnect is a first-order reliability problem.
- A large compatibility archive can become a security burden. Do not add legacy builds without demand evidence and CI coverage.
- Media licensing and software licensing are separate decisions.
- Avoid relying on conversation context. If a fact matters, move it into the spec, an ADR, an issue, or this handoff.

## Stop protocol for the next agent

Before ending:

- update this file;
- post the same concise checkpoint on the active GitHub issue;
- record branch, commit, PR, commands/results, blockers, and next exact action;
- leave the branch buildable;
- do not start a second issue when context or credits are low.
