# Current Handoff

**Updated:** 2026-08-13

**Program state:** Six launch-boundary decisions are recorded; independent review is pending and product implementation remains gated

**Repository:** https://github.com/MeekPhills/project-ambient

**Base branch:** current `main` at `e40cf5aa62f9f30180ff743023ceadbf1ca3df9e`, integrated by merge commit `f791e41fdac02ba4c4b73ba3d3fad560a970d099`

**Planning branch:** `plan/full-platform-launch`; accepted decision content at `03a0e37` before this handoff update

**Active pull request:** #22 — https://github.com/MeekPhills/project-ambient/pull/22

**Current milestone:** M0 — Program Governance & Agent Continuity (#1)

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only active issue:** #19 — https://github.com/MeekPhills/project-ambient/issues/19

## Next exact action

Review commit `03a0e37` as a non-author against issue #19 and [decision record 0001](../decisions/0001-m0-launch-boundaries.md). Confirm the six decisions, canonical-tracker boundary, corrected commands, privacy constraints, and implementation gate. Fix any findings, push the planning branch, update PR #22 validation evidence, and record the accepted decision list on #19.

Do not begin product implementation until #19 passes independent review. After #19, make #16 the sole active issue for task-level planning and canonical tracker scope migration. #17 may establish the clean baseline only when file ownership and dependencies are explicitly non-overlapping.

## Read in this order

1. `CLAUDE.md`
2. Issue #19 and PR #22
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. M0 epic #10
6. Existing `ROADMAP.md`, `README.md`, and `docs/architecture.md`
7. The next issue selected by this file

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
- `docs/decisions/0001-m0-launch-boundaries.md`: accepted shared-core, licensing, Linux, Managed Preview, marketplace, diagnostics, and tracker boundaries.
- `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`: Static → Hybrid → Managed design, full macOS Aerial-parity contract, differentiators, cross-platform policy, compatibility archive, commercial direction, and M0–M8 gates.
- `docs/handoffs/CURRENT.md`: this atomic handoff.
- `.github/ISSUE_TEMPLATE/implementation.yml`: agent-ready task contract.
- `.github/pull_request_template.md`: evidence, energy, privacy, licensing, recovery, and handoff requirements.

No product code was changed by PR #22.

## Repository facts to verify in #17

- Remote: `MeekPhills/project-ambient`
- An older local branch `harden/supabase-private-schema` was observed and must not be repurposed.
- Verified native command paths are `swift build --package-path apps/macos` and `swift test --package-path apps/macos`.
- The aggregate verifier is `./script/verify_release.sh`; there is no `scripts/verify-release-integrity.sh`.
- MCP and website commands are defined in their package manifests and `CLAUDE.md`; #17 still owns clean execution and bounded output.
- Status PR #6 and corrective PR #23 are merged on `main` and were integrated into the isolated planning checkout before decision edits.

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
- The current 49.75/100 tracker predates expanded Windows, Linux, mobile, and Managed scope; #16 must perform one versioned canonical migration rather than introduce a competing percentage.

## Stop protocol for the next agent

Before context or credits run low:

1. stop starting new work;
2. update this file so it names exactly one active issue;
3. comment on that issue with branch, commit, PR, files changed, commands and exact results, blockers, risks, and next exact action;
4. leave the branch buildable and preserve unrelated/user changes;
5. mark unfinished work draft; never depend on chat history for resumption.
