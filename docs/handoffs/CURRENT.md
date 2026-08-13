# Current Handoff

**Updated:** 2026-08-13

**Program state:** M0 launch boundaries and the dependency/tracker migration are accepted. The sole canonical tracker is schema v3 and is live at 15/100. Product implementation remains gated until the remaining M0 contracts and final integration gate are accepted.

**Repository:** https://github.com/MeekPhills/project-ambient

**Base branch:** `main` at `a5b3f41b4155f8bfe8bf859934314746c943cfea`

**Working branch:** `feat/20-capability-contract`

**Active pull request:** draft PR #26 — https://github.com/MeekPhills/project-ambient/pull/26

**Current milestone:** M0 — Governance and architecture

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only integration-active issue:** #20 — https://github.com/MeekPhills/project-ambient/issues/20

Issue #17 remains an independent draft evidence stream in its own worktree and owns only `docs/reports/m0-issue-17-repository-baseline.md`. It has zero accepted tracker credit and does not share edit ownership with #20.

## Next exact action

Await final non-author approval of commit `88411aec574b65020d61875e13e3b4dc111e8f80` and final-head GitHub gates. If both pass, mark PR #26 ready, merge, then update and deploy the canonical tracker before closing #20 or awarding its M0 point.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #20
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json` task `m0-capability-contract`
6. `ROADMAP.md`
7. `apps/site/app/status/status-manifest.json`

## Accepted evidence

- PR #22 / issue #19: six M0 launch decisions accepted and merged.
- PR #25 / issue #16: 41-task dependency plan, M0–M8 roadmap, and schema-v3 canonical tracker accepted and merged.
- Production status deployment: https://project-ambient.meekphillies.chatgpt.site/status
- Current canonical readiness: 15/100 — M0 3/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7.
- The historical 49.75/100 schema-v2 audit remains evidence history, not a second current score.

## Issue #20 definition of done

- A versioned language-neutral JSON Schema covers build identity, OS/version, architecture, integration method, support lifecycle, evidence, explanations, and the accepted capability domains.
- Examples exist for macOS, Windows, Linux, iOS/iPadOS, and Android.
- Support states distinguish `supported`, `experimental`, `unavailable_by_os`, `unavailable_by_build`, and `archived`.
- Every capability state carries evidence and an exact user-facing explanation; no capability is inferred from platform identity.
- Release artifacts have a machine-valid embed-or-link contract.
- Positive, negative, and backward/forward compatibility fixtures pass `node script/validate_capabilities.mjs`.
- Non-author review approves the contract before merge.

## Ownership and safety

- #20 owns `schemas/capabilities/**`, `fixtures/capabilities/**`, `script/validate_capabilities.mjs`, and this handoff checkpoint.
- The pre-existing dirty checkout at `/Users/luismorrobel/Library/Mobile Documents/com~apple~CloudDocs/Codename Ambiant` is protected and untouched. Never reset, clean, stash, switch, overwrite, or integrate from it.
- No product implementation, user media, secrets, credentials, stores, submissions, payments, or public announcements are in scope.
- Do not infer support from an OS name. Example manifests are contract fixtures, not shipped-product claims, unless their evidence says otherwise.

## Verification baseline

- Initial commit: `17ac6b764b2d8bc1b64701ccf6d5b01a1cf33570`
- `node script/validate_capabilities.mjs`: passed at the initial commit — schema v1 metadata/manual rules, 5 fixtures, 20 explicit capabilities per fixture, 7 negative/compatibility checks. Reviewer correctly required actual published-schema evaluation and executable release bindings before approval.
- `node script/validate_implementation_plan.mjs`: passed — 41 tasks, 9 milestones, 100 points, acyclic.
- JSON parsing and `node --check script/validate_capabilities.mjs`: passed.
- `git diff --check`: passed.
- Non-author review at `17ac6b7`: **changes required**; corrections are in progress and no credit is claimed.
- Correction commit `9004b26736479aae6aee44d20aa72799fecc177d`: published-schema evaluation, 5 fixtures × 20 capabilities, 7 negative/compatibility cases, 3 embedded/linked/digest checks, conservative macOS claim states, release preflight/CI hook, and the declared worktree path all pass.
- Re-review at `9004b26`: release-binding, evidence, release-hook, and worktree findings resolved; final approval remains pending a fail-closed schema-keyword audit and this current checkpoint.
- Final correction commit `88411aec574b65020d61875e13e3b4dc111e8f80`: fail-closed schema-keyword audit, unsupported-keyword negative, linked-claim identity check, wrong-platform negative, and refreshed checkpoint pass locally; final re-review is pending.
- Required corrected smoke: `node script/validate_capabilities.mjs`
- Required hygiene: `git diff --check`
- Release-link behavior must be tested without publishing a release; `script/verify_release.sh` and release-integrity CI must invoke the focused preflight.
- The #17 native build instability and site dependency advisories remain independent baseline risks; #20 does not claim to resolve them.

## M0 remaining order

1. #20 — versioned platform capability contract (**current**)
2. #17 — repository/release baseline (**independent draft; review pending**)
3. #21 — software, media-rights, and commercial boundaries
4. #18 — owned Aerial parity matrix
5. #10 integration — validators, cold-start reconstruction, tracker/handoff reconciliation, and M1 entry gate

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. keep exactly one integration-active issue in this file;
3. commit only safe scoped work;
4. post branch, commit, PR, files, exact test results, risks, blockers, and next action to the issue;
5. leave the branch buildable and the protected checkout untouched.
