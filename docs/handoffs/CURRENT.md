# Current Handoff

**Updated:** 2026-08-13

**Program state:** M0 launch boundaries, dependency/tracker migration, and the versioned capability contract are accepted. The canonical public tracker is live at 16/100. Product implementation remains gated by the remaining M0 contracts and final integration gate.

**Repository:** https://github.com/MeekPhills/project-ambient

**Base branch:** `main` at `4aafa87494cf36c3364aa989560906562cfa20eb`

**Working branch:** `docs/21-commercial-rights`

**Current milestone:** M0 — Governance and architecture

**Milestone epic:** #10 — https://github.com/MeekPhills/project-ambient/issues/10

**Only integration-active issue:** #21 — https://github.com/MeekPhills/project-ambient/issues/21

Issue #17 remains an independent draft evidence stream in its own worktree and owns only `docs/reports/m0-issue-17-repository-baseline.md`. It has zero accepted tracker credit and does not share edit ownership with #21. Issues #28 and #29 are zero-weight child contracts for the later base-M4 performance gate and local-first chat control plane; neither is active implementation work during M0.

## Next exact action

Address the non-author findings on draft PR #30, rerun focused validation and link/diff checks, then obtain final re-review. Do not mark the PR ready or award the M0 point until approval, green final-head CI, merge, tracker activation, and public verification pass.

## Read in this order

1. `CLAUDE.md`
2. This file and issue #21
3. `docs/decisions/0001-m0-launch-boundaries.md`
4. `docs/product/FULL_PLATFORM_LAUNCH_SPEC.md`
5. `docs/product/implementation-plan.json` task `m0-licensing-rights`
6. `CONTENT_RIGHTS.md` and `OPEN_SOURCE_PROMISE.md`
7. `apps/site/app/status/status-manifest.json`

## Accepted evidence

- PR #22 / issue #19: six M0 launch decisions accepted and merged.
- PR #25 / issue #16: 41-task dependency plan, M0–M8 roadmap, and schema-v3 canonical tracker accepted and merged.
- PR #26 / issue #20: capability schema v1, five platform fixtures, fail-closed validation, and release binding accepted and merged.
- PR #27 merged as `4aafa87494cf36c3364aa989560906562cfa20eb`; its exact site subtree was deployed as Sites version 16.
- Production tracker: https://project-ambient.meekphillies.chatgpt.site/status
- Current readiness: 16/100 — M0 4/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7.
- Public smoke: `/status` renders 16/100 and 134–252 active hours; `/status/manifest` returns schema v3 and preserves the historical 49.75 audit; `/api/status?deployment=16` returns seven operational checks.

## Issue #21 definition of done

- The MIT Community core, hosted operations, genuinely commercial managed modules, creator packs, and support boundaries are explicit.
- Local/account-free operation, privacy, accessibility, restore, security, energy controls, deterministic local chat, and self-hosted-provider adapters are not paywalled.
- User-media processing grants are minimal; local media is never silently uploaded, redistributed, trained on, or appropriated.
- A versioned rights schema covers provenance, rightsholder, license, permitted use, redistribution, commercial use, attribution, derivatives, territory, term, privacy/publicity/trademark review, evidence, and takedown contacts.
- Valid public-domain, private-reference, and licensed-live-source fixtures pass; missing or contradictory rights fail.
- Software dependencies, model weights, AI providers, feeds, Apple/system media, and sports content retain independent license/terms review.
- DCO/CLA direction is explicit and counsel-required items are labeled without representing legal advice.
- Non-author licensing, privacy, and product-boundary review approves before merge.

## New cross-cutting owner requirements

- #28 makes the base 2024 M4 Mac mini (16 GB/256 GB) the reference macOS performance tier with enforceable CPU, memory, wakeup, decoder, network, frame-pacing, and 48–72 hour soak gates.
- #29 requires an in-app local-first chat control plane over the same typed command bus as direct settings. The default deterministic mode works offline without a model server; optional OS-provided or self-hosted inference may never bypass preview, policy, verification, undo, or resource attribution.
- These contracts strengthen existing M3/M4 tasks and add no score or completion credit by themselves.

## Ownership and safety

- #21 owns `CONTENT_RIGHTS.md`, `OPEN_SOURCE_PROMISE.md`, `docs/decisions/0002-commercial-rights.md`, `docs/legal/`, `schemas/rights/**`, `fixtures/rights/**`, `script/validate_rights.mjs`, and this handoff checkpoint.
- The protected dirty checkout at `/Users/luismorrobel/Library/Mobile Documents/com~apple~CloudDocs/Codename Ambiant` is untouched. Never reset, clean, stash, switch, overwrite, or integrate from it.
- Do not provide or claim legal advice. High-risk or jurisdiction-specific conclusions require qualified counsel.
- No user media, secrets, credentials, stores, submissions, payments, production deletion, or public announcement is in scope.
- Do not silently change the canonical tracker or award #21 credit on a draft branch.

## Current #21 verification

- `node script/validate_rights.mjs`: correction target — schema 1.0.0, five fixtures, and 25 negative/fail-closed checks; rerun before checkpoint.
- Rights schema and all fixture JSON parsing: passed.
- Relative Markdown links in the seven changed policy/handoff/schema documents: passed.
- `git diff --check main...HEAD`: must pass after correction; the first reviewed head had trailing-whitespace findings and its prior PASS claim is withdrawn.
- `script/verify_release.sh` and release-integrity CI invoke the rights validator; full aggregate execution remains a clean-runner gate.
- Legal-risk assessment uses a severity × likelihood register and explicitly requires qualified review; it is not legal advice.
- Non-author review at `8854cf2`: **changes required**; remote authorization, actor-scoped grants, contradiction checks, evidence privacy, strict time validation, contribution wording, and handoff accuracy are being corrected. No merge or tracker credit before final approval.

## M0 remaining order

1. #21 — software, media-rights, model/provider, and commercial boundaries (**current**)
2. #17 — repository/release baseline (**independent draft; review pending**)
3. #18 — owned Aerial parity matrix
4. #10 integration — validators, cold-start reconstruction, tracker/handoff reconciliation, and M1 entry gate

## Stop protocol

Before context or credits run low:

1. stop starting new work;
2. keep exactly one integration-active issue in this file;
3. commit only safe scoped work;
4. post branch, commit, PR, files, exact test results, risks, blockers, and next action to the issue;
5. leave the branch buildable and the protected checkout untouched.
