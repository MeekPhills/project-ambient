# Current Handoff

**Updated:** 2026-08-13

**Program state:** Every M0 dependency is accepted and merged. This final integration change supports 20/100 and M0 8/8, but production remains publicly verified at 18/100 until the exact tracker change is reviewed, merged, deployed, and smoked. M1 issue #37 is queued and may not start before that activation.

**Repository:** https://github.com/MeekPhills/project-ambient

**Parent baseline for this handoff:** `08166c73042f07654f82220265de30f5af48e7a8` on `main`, including merged PR #24.

**Working branch:** `chore/10-m0-integration` in the isolated full clone `../project-ambient-m0-integration`

**Current milestone:** M0 — Governance and architecture

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only integration-active issue:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

Issue #17's independently reviewed report is merged; the issue remains open only until this tracker activation is publicly verified. Issue #37 is the explicit queued M1 entry and has no implementation work yet. Issues #28 and #29 remain zero-weight cross-cutting contracts for the later base-M4 performance gate and local-first chat control plane; neither receives implementation credit from M0.

## Next exact action

Run every M0 validator and the production site render suite for this 20/100 integration change, then obtain a non-author risk and cold-start reconstruction review. Open a focused #10 PR, require same-head CI and release integrity, merge, deploy the exact site subtree, and publicly verify `/status`, `/status/manifest`, and `/api/status`. Only then close #17 and #10 and promote #37 as the sole integration-active issue.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #10
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json` task `m0-integration` and queued task `m1-onboarding-import`
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
- PR #33 merged as `7f3e97f0f30f1e9007d80fe82cc1feeeb7aaddb5` after exact-head non-author approval and green macOS, MCP, site, secret-scan, release-integrity, and CodeQL jobs. Issue #18 is closed.
- PR #34 merged as `2f0b925c950db9d145a3949b3fbd53761ab21f88` from exact reviewed head `a62b5d41820cecb8047abfa21aee8422adf04c09`; all required jobs passed.
- Current readiness: 18/100 — M0 6/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7; active hands-on 125–237 hours and separate 48–72 hour soak.
- Exact site subtree source `dfc5cfceace1eb7f0276481e6cc7a35fd0001956` is deployed as Sites version 18. Public smoke passed: `/status` renders 18/100 and 125–237 hours; `/status/manifest` returns schema v3, exact 18/100 arithmetic, M0 6/8, workstreams 87.5/0/66/80, immutable 49.75 history, and the unchanged 15-point migration; `/api/status?deployment=18` returns all seven checks operational with HTTP 200.
- PR #24 merged as `08166c73042f07654f82220265de30f5af48e7a8` from reviewed head `fcbd34e5145a7d6266d50a1e617abc4cad6a8160`. Exact-head PR CI and explicit Release integrity dispatch 31755045429 passed native, MCP/PostgreSQL, site, CodeQL, contracts, aggregate verification, and the unsigned universal candidate. Security follow-up #36 retains the 20 site advisories and npm install-script policy with zero hidden credit.
- Merge-final readiness in this change: 20/100 — M0 8/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7; active hands-on 118–224 hours and separate 48–72 hour soak. These figures are not production-canonical before review, merge, exact deployment, and public verification.

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

- #28 makes the base 2024 M4 Mac mini (16 GB/256 GB) the reference macOS performance tier with enforceable CPU, memory, wakeup, GPU/decoder, network, storage-churn, frame-pacing, and 48–72 hour soak gates.
- #29 requires an in-app local-first chat control plane over the same typed command bus as direct settings. The default deterministic mode works offline without a model server; optional OS-provided or self-hosted inference may never bypass preview, policy, verification, undo, or resource attribution.
- These contracts strengthen existing M3/M4 tasks and add no score or completion credit by themselves.

## Ownership and safety

- #10 owns this focused integration only in `docs/product/implementation-plan.json`, the two `m1-onboarding-import` issue bindings in `docs/product/aerial-parity.json`, `apps/site/app/status/status-manifest.json`, `apps/site/tests/rendered-html.test.mjs`, and this handoff. Its issue checkpoint records the exact branch, parent, arithmetic, and merge gates.
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

1. #18 — owned Aerial parity matrix (**accepted, merged, and live**)
2. #17 — repository/release baseline (**accepted and merged; activation pending in #10**)
3. #10 integration — aggregate validators, final risk review, cold-start reconstruction, tracker/handoff reconciliation, exact deployment, and public smoke (**current**)
4. #37 — Static-first onboarding and provenance-preserving import (**queued; starts only after #10 closes**)

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
- Content commit `e75c7f34b6f72d1d53c1e2335ec8f73db6c54c8c`; final reviewed head `8ec952ecc145fd0743a64bb24f0cab1d2a1cd63a`; PR #33 merged as `7f3e97f0f30f1e9007d80fe82cc1feeeb7aaddb5`; issue #18 closed. The contract earns one M0 point only and does not claim implementation, M4 benchmark, chat, exception approval, or GA credit.

## Sites version 18 activation checkpoint

- Isolated full clone: `../project-ambient-m0-integration`; branch `chore/10-m0-integration`; parent `7f3e97f0f30f1e9007d80fe82cc1feeeb7aaddb5`.
- Exact edit ownership: `apps/site/app/status/status-manifest.json`, `apps/site/tests/rendered-html.test.mjs`, and `docs/handoffs/CURRENT.md`.
- Activated arithmetic: 18/100 overall; M0 6/8; active hands-on 125–237 hours; workstreams 87.5/0/66/80; separate 48–72 hour soak unchanged.
- Focused validation passes: implementation plan (41 tasks, nine milestones, 100 points, acyclic), Aerial parity (145 rows, 19 domains, three directions, 26 immutable evidence records, 23 adversarial checks), capabilities (five platform fixtures × 20 capabilities plus release bindings), rights (five fixtures and 29 fail-closed checks), JSON/diff checks, production site build, and all 12 rendered-route tests.
- The installed `project-ambient-status` helper still rejects schema v3 because it hard-codes the retired three-bar 45/45/10 model. The repository's accepted M0–M8 plan, manifest arithmetic, and render tests are authoritative; this known helper mismatch earns no credit and must not be used to rewrite the accepted scope.
- PR #34 merged as `2f0b925c950db9d145a3949b3fbd53761ab21f88`; Sites version 18 deployment and all three public endpoint checks passed.
- At this historical checkpoint, #10 stayed open with zero task credit and #17 was the next evidence gate. PR #24 has since merged; the final M0 integration checkpoint below supersedes that next action.

## Final M0 integration checkpoint

- Current clean parent: `08166c73042f07654f82220265de30f5af48e7a8`; active branch/worktree remain `chore/10-m0-integration` / `../project-ambient-m0-integration`.
- Exact owned paths: `docs/product/implementation-plan.json`, the two `m1-onboarding-import` issue bindings in `docs/product/aerial-parity.json`, `apps/site/app/status/status-manifest.json`, `apps/site/tests/rendered-html.test.mjs`, and this handoff.
- The implementation plan now resolves the accepted #17 report path exactly. Proposed canonical arithmetic is 20/100, M0 8/8, 118–224 active hours, workstreams 100/100/66/100, and unchanged 48–72 hour soak.
- Focused implementation-plan, parity, capability, rights, JSON, shell-syntax, and diff checks pass. A fresh local site test attempt stopped before compilation with `ENOSPC` while creating Vite's temporary config; it is not a test failure and earns no smoke evidence. Only generated dependency/build caches in the isolated checkouts were removed to restore space. The clean same-head GitHub Launch site job must build and pass all 12 rendered-route tests before merge.
- M0 integration credit is merge/deploy conditional. #28, #29, #36, M1–M8 implementation, strict Aerial GA, signing, publication, and soak receive no new credit.
- Queued M1 issue: #37 — https://github.com/MeekPhills/project-ambient/issues/37. Its Static-first flow preserves originals, uses the same typed direct/chat command contract, measures against the base M4 contract, and may not start before public M0 activation.

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. keep exactly one integration-active issue in this file;
3. commit only safe scoped work;
4. post branch, commit, PR, files, exact test results, risks, blockers, and next action to the issue;
5. leave the branch buildable and the protected checkout untouched.
