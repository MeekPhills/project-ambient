# Current Handoff

**Updated:** 2026-08-13

**Program state:** M0 launch boundaries, dependency/tracker migration, the versioned capability contract, and the rights/commercial boundary are accepted. The canonical production tracker is live at 17/100. Product implementation remains gated by the repository baseline, owned Aerial parity matrix, and final M0 integration gate.

**Repository:** https://github.com/MeekPhills/project-ambient

**Parent baseline for this handoff:** `846cef807eceaaa11926bae290021c26475c49fd`. After PR #32 merges, resolve and branch from the then-current `main`; never assume this parent remains the head.

**Working branch:** create an isolated `codex/18-aerial-parity-matrix` branch/worktree from current `main` before editing

**Current milestone:** M0 — Governance and architecture

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only integration-active issue:** #18 — https://github.com/MeekPhills/project-ambient/issues/18

Issue #17 remains an independent draft evidence stream in its own worktree and owns only `docs/reports/m0-issue-17-repository-baseline.md`. It has zero accepted tracker credit and does not share edit ownership with #18. Issues #28 and #29 are zero-weight child contracts for the later base-M4 performance gate and local-first chat control plane; neither is active implementation work during M0.

## Next exact action

Start #18 in a new isolated worktree: inventory the accepted Aerial feature universe and convert every row into a machine-validated owner, milestone, issue, evidence source/version, implementation status, automated/manual test, and explicit exception record. Preserve semantic parity without copying Aerial's implementation or visual identity. Do not award the M0 point until the complete matrix, validator, non-author review, and merge gate pass.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #18
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json` task `m0-aerial-parity`
6. Aerial's versioned primary evidence: [4.0.14 source](https://github.com/AerialScreensaver/Aerial/tree/v4.0.14), [4.1.0beta13 source](https://github.com/AerialScreensaver/Aerial/tree/v4.1.0beta13), [official features](https://aerialscreensaver.github.io/features/), [official FAQ](https://aerialscreensaver.github.io/faq/), [release notes](https://aerialscreensaver.github.io/release-notes/), and [expansions](https://aerialscreensaver.github.io/expansions/). Freeze the exact tag/commit and retrieval date in every matrix evidence row; use repository source over remembered chat claims.
7. `schemas/capabilities/` and `apps/site/app/status/status-manifest.json`

## Accepted evidence

- PR #22 / issue #19: six M0 launch decisions accepted and merged.
- PR #25 / issue #16: 41-task dependency plan, M0–M8 roadmap, and schema-v3 canonical tracker accepted and merged.
- PR #26 / issue #20: capability schema v1, five platform fixtures, fail-closed validation, and release binding accepted and merged.
- PR #27 merged as `4aafa87494cf36c3364aa989560906562cfa20eb`; its exact site subtree was deployed as Sites version 16.
- PR #30 merged as `d958be915648e7b5586b882f9c9e6694610a01dc` after non-author approval and green CI, CodeQL, release integrity, and rights-contract validation.
- Production tracker: https://project-ambient.meekphillies.chatgpt.site/status
- PR #31 merged as `846cef807eceaaa11926bae290021c26475c49fd`; exact subtree source `dfc9789f18e4378a1d84ec1b8adadffea4cd8c04` deployed as Sites version 17.
- Current readiness: 17/100 — M0 5/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7.
- Public smoke passed: `/status` renders 17/100 and 131–247 active hours; `/status/manifest` returns schema v3, exact 17/100 arithmetic, M0 5/8, and immutable 49.75 history; `/api/status?deployment=17` returns seven operational checks.

## Issue #21 definition of done

- The MIT Community core, hosted operations, genuinely commercial managed modules, creator packs, and support boundaries are explicit.
- Local/account-free operation, privacy, accessibility, restore, security, energy controls, deterministic local chat, and self-hosted-provider adapters are not paywalled.
- User-media processing grants are minimal; local media is never silently uploaded, redistributed, trained on, or appropriated.
- A versioned rights schema covers provenance, rightsholder, license, permitted use, redistribution, commercial use, attribution, derivatives, territory, term, privacy/publicity/trademark review, evidence, and takedown contacts.
- Valid public-domain, personal private-reference, private-enterprise, paid-creator, and licensed-live-source fixtures pass; missing or contradictory rights fail.
- Software dependencies, model weights, AI providers, feeds, Apple/system media, and sports content retain independent license/terms review.
- DCO/CLA direction is explicit and counsel-required items are labeled without representing legal advice.
- Non-author licensing, privacy, and product-boundary review approves before merge.

## New cross-cutting owner requirements

- #28 makes the base 2024 M4 Mac mini (16 GB/256 GB) the reference macOS performance tier with enforceable CPU, memory, wakeup, decoder, network, frame-pacing, and 48–72 hour soak gates.
- #29 requires an in-app local-first chat control plane over the same typed command bus as direct settings. The default deterministic mode works offline without a model server; optional OS-provided or self-hosted inference may never bypass preview, policy, verification, undo, or resource attribution.
- These contracts strengthen existing M3/M4 tasks and add no score or completion credit by themselves.

## Ownership and safety

- #18 owns only the Aerial parity matrix, its schema/validator/fixtures, focused documentation, and this handoff checkpoint. Establish exact file paths in the issue checkpoint before editing.
- The protected dirty checkout at `/Users/luismorrobel/Library/Mobile Documents/com~apple~CloudDocs/Codename Ambiant` is untouched. Never reset, clean, stash, switch, overwrite, or integrate from it.
- Do not copy Aerial code, assets, branding, or trade dress. Record semantic behavior and independently implement/test the resulting contract.
- No user media, secrets, credentials, stores, submissions, payments, production deletion, or public announcement is in scope.
- Do not silently change the canonical tracker or award #18 credit on a draft branch.

## Accepted #21 contract and activation verification

- Correction commits `8311c1c9ea847299ff56caf81b8671e6b736dbc0` and `85dabbbe932850fdb75afc7b7a7383510dd7b762`: actor-scoped Project/end-user grants, enforced grantee roles, verified remote providers, exact provider-terms/origin/source-descriptor/transport binding, private evidence records, paid-personal and private-enterprise fixtures, contradiction/time checks, and clarified contribution policy.
- `node script/validate_rights.mjs`: passed — schema 1.0.0, five fixtures, and 29 negative/fail-closed checks.
- Rights schema and all fixture JSON parsing: passed.
- Relative Markdown links in the seven changed policy/handoff/schema documents: passed.
- `git diff --check 4aafa87494cf36c3364aa989560906562cfa20eb...HEAD`: passed after correction; the first reviewed head's inaccurate PASS claim is superseded by this exact result.
- `script/verify_release.sh` and release-integrity CI invoke the rights validator; full aggregate execution remains a clean-runner gate.
- Legal-risk assessment uses a severity × likelihood register and explicitly requires qualified review; it is not legal advice.
- Final non-author review at `331bdc56c7bd4486d5430c31b0bce3a4038bb5cd`: **approved**; all residual actor, provider-evidence, time, transport, and documentation findings are closed.
- Final-head CI, CodeQL, release integrity, macOS/site/MCP tests, secret scan, rights validation, and universal release-candidate packaging: passed.
- PR #30 and tracker PR #31 are merged; Sites version 17 passed exact production verification. Issue #21 is eligible for completed closure.

## M0 remaining order

1. #18 — owned Aerial parity matrix (**current**)
2. #17 — repository/release baseline (**independent draft; review pending**)
3. #10 integration — validators, cold-start reconstruction, tracker/handoff reconciliation, and M1 entry gate

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. keep exactly one integration-active issue in this file;
3. commit only safe scoped work;
4. post branch, commit, PR, files, exact test results, risks, blockers, and next action to the issue;
5. leave the branch buildable and the protected checkout untouched.
