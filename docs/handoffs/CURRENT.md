# Current Handoff

**Updated:** 2026-08-13

**Program state:** M0 launch boundaries are accepted. Issue #16 has a machine-valid dependency plan and a schema-v3 migration of the sole canonical tracker; non-author review is approved, exact-head verification and PR/merge remain. Product implementation is still gated by the rest of M0.

**Repository:** https://github.com/MeekPhills/project-ambient

**Base branch:** `main` at merge commit `e46979ec163239887c2eff04edbf7bb3109dbd4d`

**Working branch:** `plan/m0-dependency-tracker` in its own clean worktree; plan at `acf9053`, review corrections at `98957e7`, and this final checkpoint update pending commit

**Completed planning pull request:** #22 — https://github.com/MeekPhills/project-ambient/pull/22

**Current milestone:** M0 — Governance and architecture

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only integration-active issue:** #16 — https://github.com/MeekPhills/project-ambient/issues/16

Issue #17 is a bounded parallel read/verification stream in a different worktree and owns only `docs/reports/m0-repository-baseline.md`. It may not edit this handoff, roadmap, implementation plan, status manifest/UI/tests, or product code.

## Next exact action

Commit this final checkpoint, rerun the exact-head plan validator and full site build/render suite, then push and open the issue #16 PR. Merge only after CI/CodeQL and the cold-start reconstruction smoke pass; deploy the exact merged commit before treating schema v3's 15/100 as the public current score.

After #16, make #20 the sole integration-active issue for the versioned capability contract. Accept issue #17 independently when its evidence report passes review. Product implementation remains blocked until #17, #21, #20, #18, and final M0 integration are accepted.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #16
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json`
6. `ROADMAP.md`
7. `apps/site/app/status/status-manifest.json`
8. M0 epic #10 and the next issue named here

## Issue #16 artifacts and decisions

- `docs/product/implementation-plan.json`: 41 task contracts across M0–M8. Every task names milestone weight, owner, size, branch, parallel group, dependencies, mutable areas, acceptance criteria, and verification.
- Every task also has an existing issue or create-before-start issue gate, an isolated/accepted worktree identity, and a stop/checkpoint escalation path to the Sol integrator.
- `script/validate_implementation_plan.mjs`: fails on missing fields, duplicate IDs, unknown dependencies, dependency cycles, milestone weight drift, broken first-slice sequencing, same-group exact area conflicts, plan/manifest task mismatch, or historical-score loss.
- `ROADMAP.md`: human-readable M0–M8 sequence and exit smoke for every milestone.
- GitHub milestone epic issues now record the same canonical weights: M0 8, M1 14, M2 12, M3 20, M4 14, M5 12, M6 7, M7 6, and M8 7. Direct milestone-description mutation remains pending because the authenticated connector does not expose it and the requested external-browser extension is disconnected.
- `apps/site/app/status/status-manifest.json`: the only current 100-point tracker, version-migrated from 45/45/10 to weights 8/14/12/20/14/12/7/6/7.
- The historical 49.75/100 audit is preserved in `scoreHistory` with its phase totals, effort ranges, timestamp, and source commit. It is history, not a second live score.
- `migration.creditMappings` provides an exact evidence crosswalk for all 15 remapped points, including prior schema-v2 task IDs or post-history/merge-conditional sources and immutable evidence links.
- Current expanded-scope credit is a conservative 15/100: M0 3, M1 5, M2 1, M3 0.5, M4 3, M5 0, M6 0, M7 0.5, M8 2. Only merged/accepted alpha and M0 artifacts with smoke evidence are credited.
- The #16 task's 1.5 points and the 15/100 schema-v3 score are merge-conditional final-state content. Until this branch is reviewed, merged, and deployed, the public schema-v2 49.75/100 audit remains the current score.
- Microsoft enterprise distribution and Google A2A remain deferred outside the weighted scope at 84–168 hours. The accepted active planning baseline remains 138–259 hours plus a separate 48–72 hour soak until task evidence supports re-estimation.
- The first product slice is strictly sequenced: onboarding/import → display continuity → lock-only rotation → recovery/accessibility. It cannot start until final M0 integration.

## Verification completed in this branch

- `node script/validate_implementation_plan.mjs`: **passed** — 41 tasks, 9 milestones, 100 points, acyclic dependencies.
- Focused status-manifest Node test: **passed** — 1 test, 0 failures; validates schema v3, 15/100 current score, preserved 49.75 history, exact milestone/task weights, 138–259 active hours, 84–168 deferred hours, and 48–72 soak.
- `git diff --check`: **passed** at the pre-review checkpoint.
- `npm --prefix apps/site test`: **passed** — production build completed and all 12 server-render/status/API tests passed.
- `npm --prefix apps/site run lint`: **failed on 14 inherited `@next/next/no-html-link-for-pages` errors in unchanged `Footer.tsx`, `Header.tsx`, and `not-found.tsx`; no changed file produced a lint finding.** The baseline issue owns recording/linking this existing gap; #16 does not mix an unrelated UI refactor into the tracker PR.
- Non-author plan/tracker review: **approved** after corrections. The reviewer verified all 41 issue/worktree/escalation contracts, exact plan/manifest dependencies, 15-point evidence crosswalk, merge activation gate, and milestone-linked epic weights.
- GitHub epic→milestone verification: **passed 9/9** — #10/#8/#14/#7/#11/#9/#12/#13/#15 are attached to M0–M8 respectively and record weights 8/14/12/20/14/12/7/6/7.
- GitHub CI/CodeQL: **pending PR**.

## Protected state and ownership

- A pre-existing dirty checkout on another branch remains protected and untouched. Never reset, clean, stash, switch, overwrite, or integrate from it.
- This branch owns `ROADMAP.md`, `docs/product/implementation-plan.json`, `script/validate_implementation_plan.mjs`, the status manifest/model/dashboard/tests/styles, and this handoff.
- Issue #17 owns only its report in its separate worktree. No two active agents share mutable files.
- No product code, user media, credentials, production resources, stores, payments, submissions, or public announcements are in scope for #16.

## M0 remaining order

1. #16 — dependency plan and canonical tracker migration (**current**)
2. #17 — clean repository/release baseline (parallel evidence stream)
3. #20 — versioned platform capability contract
4. #21 — software, media-rights, and commercial boundaries
5. #18 — owned Aerial parity matrix
6. #10 integration — validators, cold-start reconstruction, tracker/handoff reconciliation, and M1 entry gate

The #20/#21/#18 order may be parallelized only with distinct file ownership and at most three active instances. M1 does not start until the M0 integration gate passes.

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. update this file so it names exactly one integration-active issue;
3. comment on that issue with branch, commit, PR, files changed, commands/results, blockers, risks, and next exact action;
4. leave the branch buildable and preserve unrelated/user changes;
5. mark unfinished work draft and release unused agents; never depend on chat history.
