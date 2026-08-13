# Current Handoff

**Updated:** 2026-08-12  
**Program state:** Handover prepared; product implementation is gated on design approval  
**Repository:** https://github.com/MeekPhills/project-ambient  
**Base branch:** `main` at `6ab0b4926439a14eda7d0608b4b4e5f581048c3b` when PR opened  
**Planning branch:** `plan/full-platform-launch` at `80fc23306a498fa21177335ceb5c39691b6a84b7` before this update  
**Active pull request:** #22 — https://github.com/MeekPhills/project-ambient/pull/22  
**Current milestone:** M0 — Program Governance & Agent Continuity (#1)  
**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10  
**Only active issue:** #19 — https://github.com/MeekPhills/project-ambient/issues/19

## Next exact action

Review `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md` through draft PR #22 and resolve or explicitly defer the six decisions in issue #19:

1. shared-core prototype scope;
2. software-license direction;
3. first Linux desktop/session targets;
4. Managed GA versus commercial-preview timing;
5. content marketplace timing;
6. opt-in diagnostics schema and retention.

Do not begin product implementation until #19 records approval. After #19, proceed to #16 for task-level planning and #17 for baseline verification. Work on only one issue at a time unless GitHub dependencies and non-overlapping files make parallel work explicit.

## Read in this order

1. `CLAUDE.md`
2. Issue #19 and PR #22
3. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
4. M0 epic #10
5. Existing `ROADMAP.md`, `README.md`, and `docs/architecture.md`
6. The next issue selected by this file

## GitHub program state

Nine milestones exist without speculative due dates:

- M0 — Program Governance & Agent Continuity
- M1 — Guided Static Foundation
- M2 — Media Library & Content Ecosystem
- M3 — macOS Renderer & Aerial Feature Parity
- M4 — Automation, Energy & Resilience
- M5 — Windows & Linux Desktop
- M6 — Mobile Companions & OS Integrations
- M7 — Managed, Enterprise & Commercial
- M8 — Public GA, Distribution & Compatibility Archive

Each milestone has one epic:

- M0: #10
- M1: #8
- M2: #14
- M3: #7
- M4: #11
- M5: #9
- M6: #12
- M7: #13
- M8: #15

M0 execution issues:

- #19 — review and approve the launch design (**active**)
- #21 — define software, media-rights, and commercial boundaries
- #20 — define the platform capability manifest
- #18 — convert Aerial parity into an owned test matrix
- #16 — publish dependency map and task-level implementation plan
- #17 — verify repository baseline and release-integrity commands

## What is in PR #22

- `CLAUDE.md`: Claude Code pickup, branch discipline, verification, definition of done, and credit/context stop protocol.
- `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`: Static → Hybrid → Managed design, full macOS Aerial-parity contract, differentiators, cross-platform policy, compatibility archive, commercial direction, and M0–M8 gates.
- `docs/handoffs/CURRENT.md`: this atomic handoff.
- `.github/ISSUE_TEMPLATE/implementation.yml`: agent-ready task contract.
- `.github/pull_request_template.md`: evidence, energy, privacy, licensing, recovery, and handoff requirements.

No product code was changed by PR #22.

## Repository facts to verify in #17

- Remote: `MeekPhills/project-ambient`
- Local checkout: `/Users/luismorrobel/Library/Mobile Documents/com~apple~CloudDocs/Codename Ambiant`
- An older local branch `harden/supabase-private-schema` was observed and must not be repurposed.
- Existing project commands include `swift test`, `swift build`, and `./scripts/verify-release-integrity.sh`; #17 must verify their exact locations and current results.
- MCP and website validation commands must be discovered from current repository docs/scripts and recorded rather than guessed.
- Open PR #6 is separate status-evidence work and must remain isolated from PR #22.

## Product facts that must survive handoff

- One progressively disclosed product: Static, Hybrid, and Managed.
- Static is the default onboarding path and must support first-class photos and near-zero idle rendering.
- macOS public GA is blocked on full permitted Aerial capability parity with evidence or a documented legal/OS exception.
- Windows and Linux use capability-equivalent native adapters.
- iOS/iPadOS and Android expose only behavior permitted by those operating systems; no false parity claims.
- Source media is preserved. Imports never move or delete originals by default.
- Every live source has a cached/local still fallback.
- Every automatic decision exposes Now / Next / Why.
- Legacy builds are added only with vendor support or measured demand plus CI; archived status is explicit.
- GitHub is the source of truth for program state. Conversation history is not a dependency.

## Risks

- Aerial parity is a large launch gate and must be controlled through issue #18 rather than implicit scope.
- Display topology changes after sleep/reconnect are a first-order reliability problem.
- Live feeds and overlays can erase the energy advantage without M4’s degradation ladder.
- Cross-platform native integration cannot be forced into false lowest-common-denominator parity.
- Media rights and software licensing are separate decisions.
- A large compatibility archive becomes a security burden without evidence and maintained CI.

## Stop protocol for the next agent

Before context or credits run low:

1. stop starting new work;
2. update this file so it names exactly one active issue;
3. comment on that issue with branch, commit, PR, files changed, commands and exact results, blockers, risks, and next exact action;
4. leave the branch buildable and preserve unrelated/user changes;
5. mark unfinished work draft; never depend on chat history for resumption.
