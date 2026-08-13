# Current Handoff

**Updated:** 2026-08-13

**Program state:** M0 launch boundaries, dependency/tracker migration, the versioned capability contract, and the rights/commercial boundary are accepted. The canonical production tracker is live at 17/100. Product implementation remains gated by the repository baseline, owned Aerial parity matrix, and final M0 integration gate.

**Repository:** https://github.com/MeekPhills/project-ambient

**Parent baseline for this handoff:** `60d2a251661cdbdb4ccbe20ede427dc2f326619d` on `main`, including merged PR #32.

**Working branch:** `docs/18-aerial-parity-matrix` in the isolated full clone `../project-ambient-m0-aerial-parity`

**Current milestone:** M0 — Governance and architecture

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only integration-active issue:** #18 — https://github.com/MeekPhills/project-ambient/issues/18

Issue #17 remains an independent draft evidence stream in its own worktree and owns only `docs/reports/m0-issue-17-repository-baseline.md`. It has zero accepted tracker credit and does not share edit ownership with #18. Issues #28 and #29 are zero-weight child contracts for the later base-M4 performance gate and local-first chat control plane; neither is active implementation work during M0.

## Next exact action

Require and verify clean-runner CI on PR #33 at the exact current head, then confirm required review against that same head. After green CI and review, merge and run the normal tracker activation gate. Do not award the M0 point before those gates pass.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #18
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json` task `m0-aerial-parity`
6. `docs/product/aerial-parity.json`, `schemas/aerial-parity/v1/aerial-parity.schema.json`, and `script/validate_aerial_parity.mjs`
7. Aerial's versioned primary evidence: [4.0.14 source](https://github.com/AerialScreensaver/Aerial/tree/v4.0.14), [4.1.0beta13 source](https://github.com/AerialScreensaver/Aerial/tree/v4.1.0beta13), [official features](https://aerialscreensaver.github.io/features/), [official FAQ](https://aerialscreensaver.github.io/faq/), [release notes](https://aerialscreensaver.github.io/release-notes/), and [expansions](https://aerialscreensaver.github.io/expansions/). Matrix evidence freezes exact tag/commit and retrieval date; repository source takes precedence over remembered chat claims.
8. `schemas/capabilities/` and `apps/site/app/status/status-manifest.json`

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

## #18 working checkpoint

- The first partial-clone worktree failed hydration and appeared to stage tracked files as deleted. It was never committed or pushed. Its isolated local branch was removed, and the protected dirty checkout remains untouched.
- Clean full clone: `../project-ambient-m0-aerial-parity`; branch `docs/18-aerial-parity-matrix`; parent `60d2a251661cdbdb4ccbe20ede427dc2f326619d`.
- Frozen upstream baselines: Aerial `v4.0.14` at `15f9c35b9db69795325eab608fa00f11ef13a0a3`; `v4.1.0beta13` at `0083c721dcc0fa6df55a0a011678c11493ad2810`; official gh-pages evidence at `a9c94622a2db978bdfaa9a72a7228dbad6019573`; retrieved 2026-08-13.
- Canonical matrix: 145 rows across all 19 accepted domains and Static, Hybrid, and Advanced Live. Every row has owner, milestone, implementation task, issue gate, planned implementation state, version-bound evidence, test, and exception where required. Explicit all-row resource and chat conformance suites map every capability to the zero-credit contracts #28 and #29; both suites carry status and durable evidence fields and must pass GA.
- Explicit exceptions: no arbitrary shell execution from overlay messages; no system-wide audio takeover. Typed local actions/files and app-scoped audio are the safer alternatives.
- First non-author review: **changes required**. The corrected matrix adds per-app occlusion exclusions, legacy migration and rerunnable defaults, VoiceOver announcements, tags/energy/rights filters, display flip, dip/zoom transitions, inspectable network domains, integration consent, settings export/delete, hardware decode, and broken-item handling. Issue #18 ownership was durably amended to include `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md` in [checkpoint 5287257989](https://github.com/MeekPhills/project-ambient/issues/18#issuecomment-5287257989).
- `node script/validate_aerial_parity.mjs`: passed — schema v1, 145 rows, 19 domains, three directions, 26 evidence records, 23 negative/fail-closed checks, and a synthetic future-GA pass.
- Current `node script/validate_aerial_parity.mjs --ga`: intentionally fails closed with 296 findings because both cross-cutting suites, all implementation/test states, and both exceptions are still planned or pending. The future tag gate requires both #28/#29 suites passed with durable evidence, every row verified, every test passed, and every exception approved with durable evidence.
- `script/verify_release.sh` and release-integrity CI invoke contract validation; GA-tag CI invokes `--ga`. Workflow paths include the matrix, its schema, and the linked launch spec. Full aggregate execution remains a clean-runner merge gate; this checkpoint awards no implementation or tracker credit.
- Final non-author review of the current filesystem: **approved**. It independently reran contract and strict-GA behavior, shell syntax, and diff checks; all prior coverage, origin, baseline, cross-cutting, exception, workflow, claim-honesty, and ownership findings are closed.
- Content commit `e75c7f34b6f72d1d53c1e2335ec8f73db6c54c8c`; first checkpoint `db190b48b453e57c1f6c783fe586f990f284cd3b`; branch pushed and draft PR #33 open. This factual checkpoint follows; clean-runner CI, merge, and tracker activation are pending.

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. keep exactly one integration-active issue in this file;
3. commit only safe scoped work;
4. post branch, commit, PR, files, exact test results, risks, blockers, and next action to the issue;
5. leave the branch buildable and the protected checkout untouched.
