# Current Handoff

**Updated:** 2026-08-22

**Program state:** M0 is complete at 8/8. The canonical tracker is publicly verified at 20/100 on Sites version 19. M1 issue #37 is the sole integration-active work item; no M1 implementation credit has been awarded.

**Repository:** https://github.com/MeekPhills/project-ambient

**Parent baseline for this handoff:** `bb184e9c9e34e5cbb0ae9bff3704386bd86b6ebb` on `main`, including merged PR #38.

**Working branch:** documentation checkpoint `docs/37-m1-entry-handoff` in `../project-ambient-m0-integration`; implementation must use `feat/37-static-onboarding-import` in the clean isolated worktree `../project-ambient-m1-onboarding-import`

**Current milestone:** M1 — Guided Static Foundation

**Milestone epic:** #8 — https://github.com/MeekPhills/project-ambient/issues/8

**Only integration-active issue:** #37 — https://github.com/MeekPhills/project-ambient/issues/37

Issues #17 and #10 are closed after public tracker activation. Issue #37 has a complete entry gate and DoD but no implementation work yet. Issues #28 and #29 remain zero-weight cross-cutting contracts for the base-M4 performance gate and local-first chat control plane; issue #36 remains the uncredited release-security dependency follow-up.

## Display-control expansion checkpoint (2026-08-16)

The BetterDisplay-class display-management expansion's WS-DC-001 governance is merged: PR #40 merged as `fde6b21ec8138e8f0a0fd2eb43cb562fc1cab15e` on 2026-08-16 and governance issue #41 is closed. ADR 0003 is **Accepted** via PR #42, merged as `1bce142aace71294858bbe61f0a78029ffa6f859`. The expansion still awards **zero tracker credit** and changes no canonical arithmetic; the canonical tracker stays 20/100 on schema v3.

- Frozen comparator: BetterDisplay **4.3.6** build 50119 (tag `046b59f8c04e8b46872ee270f5cee76cc1ef1803`, landing `c71b73d5e024c793e8df7be2742017a81599b0cc`); v5.0.2 stays a prerelease watchlist item.
- `docs/product/display-control-capability-register.json` — 115 rows: the full official Free (40) and Pro (37) matrix 1:1 plus 38 cross-cutting rows; dispositions 62 supported / 36 experimental / 6 manual-only / 1 unavailable / 10 blocked; `launchGate.fullReplacementClaim` is false and validator-enforced. Every `evidenceCatalog` entry now carries an immutable `pin` (7 git-commit, 3 content-hash, 2 explicit unpinnable-live with reasons; the APPLE-CG catalog URI returned a stable HTTP 404 on 2026-08-16 and is honestly recorded as unpinnable).
- `docs/product/display-control-source-crosswalk.json` — the WS-DC-001 follow-on delivered under issue #43 on branch `docs/43-display-control-crosswalk`: every register row mapped exactly once to its pinned evidence, with a `catalogUsage` map proving every catalog entry is used by at least one row or the frozen baseline binding.
- `schemas/display-control/v1/capability-register.schema.json` + `script/validate_display_control.mjs` — fail-closed, wired into `script/verify_release.sh`, twenty-three tamper self-tests all rejecting (baseline drift, private SPI claimed supported, hidden credit fields, missing consent/kill-switch gates, premature replacement claim, dropped/duplicated crosswalk rows, crosswalk/evidence mismatch, malformed or missing pins, unused catalog entries, and more). A missing or unparsable crosswalk fails the run.
- `docs/decisions/0003-display-control-expansion.md` (Accepted), `docs/reports/display-control-risk-register.md` (17 risks), `docs/product/tracker-schema-v4-proposal.md` (NOT active; corrected against the real nine-milestone manifest, which reconciles 20/100 exactly), and `docs/orchestration/` (recovery ledger, work graph).
- Still owner-gated: physical MSI/Dell qualification; the private-SPI/EDID/remote-streaming/privileged-helper decisions; any schema-v4 activation step.
- Issue #37 remains the only integration-active issue; its Mac-local importer worktree and the protected checkout were untouched by this work. PR #44 — the first #37 slice (typed copy/reference import with provenance, reviewed head `fcdbe7e`, exact-head CI green) — merged as `ca975278b4195d88c2d19ae3b995611665fee9d6` on 2026-08-16 by the delegated session automation after independent verification and green exact-head CI, without a separate owner merge instruction (provenance recorded on issue #37); #37 stays open with zero new credit.

## Asset attribution checkpoint (2026-08-22)

Issue #51 is implemented on `feat/51-asset-attribution` from current `main` (`b908242`): imported assets can carry the accepted rights vocabulary's private-reference, public-domain, or attributed-license basis; `photo-manifest.tsv` sidecars map filename, creator, license, and source URL; unmatched rows are actionable import issues; attribution is visible in the macOS UI and returned in `ambientctl` JSON. Legacy assets and absent rights records remain compatible and fail closed. No tracker credit changes.

## Next exact action

PR #44 and PR #48 delivered the first two #37 slices; PR #49 delivered import integrity and restore coverage; PR #50 delivered screen-lock-only rotation. Remaining #37 criteria are clean-account smoke and the base-M4 benchmark trace plus privacy report under `docs/reports/`. Issue #51 is the current attribution branch; no tracker credit changes. No continuous renderer or model service; #37 closes only when every acceptance criterion has evidence.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #37
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json` task `m1-onboarding-import`
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
- Historical Sites version 18 readiness: 18/100 — M0 6/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7; active hands-on 125–237 hours and separate 48–72 hour soak.
- Exact site subtree source `dfc5cfceace1eb7f0276481e6cc7a35fd0001956` is deployed as Sites version 18. Public smoke passed: `/status` renders 18/100 and 125–237 hours; `/status/manifest` returns schema v3, exact 18/100 arithmetic, M0 6/8, workstreams 87.5/0/66/80, immutable 49.75 history, and the unchanged 15-point migration; `/api/status?deployment=18` returns all seven checks operational with HTTP 200.
- PR #24 merged as `08166c73042f07654f82220265de30f5af48e7a8` from reviewed head `fcbd34e5145a7d6266d50a1e617abc4cad6a8160`. Exact-head PR CI and explicit Release integrity dispatch 31755045429 passed native, MCP/PostgreSQL, site, CodeQL, contracts, aggregate verification, and the unsigned universal candidate. Security follow-up #36 retains the 20 site advisories and npm install-script policy with zero hidden credit.
- PR #38 merged as `bb184e9c9e34e5cbb0ae9bff3704386bd86b6ebb` from reviewed head `24a4ee923bfef766ba2b214de950fcd0bae316d7`; all exact-head CI, CodeQL, static-contract, and universal-candidate jobs passed.
- Exact site subtree source `6f5ee2e8644c2e0fd8d2af57fe644eff6153167b` is deployed as Sites version 19. Public smoke passed: `/status` renders 20% and 118–224 hours; `/status/manifest` returns schema v3, 20/100, M0 8/8, workstreams 100/100/66/100, immutable 49.75 history, and the unchanged 15-point migration; `/api/status?deployment=19` returns seven operational HTTP 200 checks.
- Current readiness: 20/100 — M0 8/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7; active hands-on 118–224 hours and separate 48–72 hour soak. Issues #17 and #10 are closed; #37 is active.

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

- Current handoff ownership is issue #37 on `docs/37-m1-entry-handoff`, limited to this file. After merge, #37 implementation ownership starts in `../project-ambient-m1-onboarding-import` on `feat/37-static-onboarding-import`. Historical #10 integration ownership and its exact files remain recorded in the M0 checkpoint below.
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

## Current delivery order

1. M0 — governance, contracts, parity, baseline, integration, deployment, and public smoke (**complete 8/8**)
2. #37 — Static-first onboarding and provenance-preserving import (**current; zero new credit**)
3. Remaining M1 tasks — display continuity, lock-only rotation, recovery/accessibility (**dependency ordered after #37**)
4. M2/M3/M4 — library/parity implementation, then measured policy/quality/energy and chat conformance (**not started under expanded DoDs**)

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
- M1 issue #37 — https://github.com/MeekPhills/project-ambient/issues/37 — is now active after public M0 activation. Its Static-first flow preserves originals, uses the same typed direct/chat command contract, and attributes resource use against the base-M4 contract.

## M0 closure evidence

- PR #38 exact reviewed head `24a4ee923bfef766ba2b214de950fcd0bae316d7` passed the clean GitHub Launch site build and all 12 rendered-route tests after the local ENOSPC attempt earned no evidence. Native, MCP/PostgreSQL, secrets, CodeQL, static contracts, and the universal unsigned candidate also passed.
- PR #38 merged as `bb184e9c9e34e5cbb0ae9bff3704386bd86b6ebb`; exact site subtree source `6f5ee2e8644c2e0fd8d2af57fe644eff6153167b` deployed successfully as Sites version 19.
- Public score, manifest arithmetic/history/migration, ETA/workstreams, and seven live checks passed. Issues #17 and #10 closed at 2026-08-14 00:05 UTC; #37 was promoted as the sole active issue.
- M0 completion does not claim implementation of the 145 parity rows, #28 base-M4 benchmarks, #29 in-app chat, #36 dependency remediation, strict GA, signing/publication, or the 48–72 hour soak. Those remain explicit zero-credit gates.

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. keep exactly one integration-active issue in this file;
3. commit only safe scoped work;
4. post branch, commit, PR, files, exact test results, risks, blockers, and next action to the issue;
5. leave the branch buildable and the protected checkout untouched.
