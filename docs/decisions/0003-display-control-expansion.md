# 0003 — Display-control expansion boundaries

**Status:** Proposed

**Date:** 2026-08-15

**Decision owner:** Project Ambient maintainer

**Tracks:** display-control governance issue (create-before-start; publication was gated on explicit owner approval and the issue does not exist yet)

## Context

Project Ambient's owner has defined a new product ambition: replace the paid BetterDisplay application and its future paid-upgrade dependence with independent, safe macOS display management. Correction on record: BetterDisplay Pro is a **perpetual major-version license**, not a subscription; the goal eliminates paid-upgrade/licensing dependence.

The ambition has earned **zero implementation credit**. The canonical tracker remains 20/100 on schema v3 and must not change until a schema-v4 migration passes its own decision gate.

The comparison baseline is frozen: BetterDisplay **4.3.6** (build 50119, bundle `pro.betterdisplay.BetterDisplay`, released 2026-08-11, tag commit `046b59f8c04e8b46872ee270f5cee76cc1ef1803`, landing commit `c71b73d5e024c793e8df7be2742017a81599b0cc`). v5.0.2 is a prerelease watchlist item, not the parity baseline.

## Decisions

### 1. One machine-checkable parity register

Every BetterDisplay 4.3.6 feature — the full official Free (40) and Pro (37) matrix plus cross-cutting program obligations — is exactly one row in `docs/product/display-control-capability-register.json`, validated fail-closed by `script/validate_display_control.mjs` against `schemas/display-control/v1/capability-register.schema.json`. The register mirrors the Aerial parity contract's discipline: frozen upstream evidence, no tracker credit fields, and a strict launch gate.

### 2. Three-way capability split, enforced by the validator

- **Supported Display Core** — documented Apple APIs or pure app-local implementation only. A `supported` row may never carry an `os-undocumented` or `private-spi-risk` basis.
- **Experimental adapters** — DDC, LG/Samsung/Philips/Yamaha network control, custom HiDPI, output color modes, virtual displays, disconnect/reconnect, and similar. Optional, separately packaged direct-distribution artifacts: opt-in, timeout-bound, kill-switchable, hardware-qualified, individually removable. Direct distribution is not permission to put private SPI into the supported product.
- **Unavailable / manual-only / blocked** — visible in the register, never hidden. `blocked` rows require an explicit owner decision (EDID override, native/direct XDR upscaling, remote streaming, privileged helper) or are rejected by design (arbitrary shell escape hatch; automatic unconfirmed hardware changes on wake/lock/thermal/power/topology events).

### 3. Clean-room boundary

BetterDisplay's application is proprietary. No application code, assets, branding, or interface trade dress is copied. Inputs are limited to user-observable behavior, official public documentation, release evidence, Apple documentation, and separately MIT-licensed projects (MonitorControl, m1ddc) reviewed on their own terms.

### 4. Architectural independence

Display-control state, transactions, and rollback are independent of wallpaper/engine state. A failed display apply restores the display without touching wallpaper state. Stale topology rejects before mutation. Safe mode is reachable without a working display configuration. Display control keeps its own last-known-good store.

### 5. One typed control plane

UI, `ambientctl`, App Intents, local chat, local MCP, and paired devices resolve to the same typed commands with identical results — consistent with the #29 chat-control contract. Preview, confirmation, policy, verification, and undo cannot be bypassed.

### 6. Tracker discipline

Schema-v3 20/100 is immutable current history. A future schema-v4 tracker stays a single canonical 100-point model (`docs/product/tracker-schema-v4-proposal.md`) and is not activated until reviewed, merged, deployed, and publicly smoke-tested. The register's `launchGate.fullReplacementClaim` is validator-enforced to `false` while any row is unqualified; no "full BetterDisplay replacement" claim ships while it is false.

### 7. Claim gates

Every `supported` claim passes base-M4 resource (#28), privacy, security, accessibility, hardware-matrix, recovery, and 48–72 hour soak gates before qualification, and ships behind signed capability manifests. ScreenCaptureKit PiP/local streaming additionally requires explicit consent and Screen Recording permission; remote streaming stays blocked behind a separate threat model.

## Consequences

- The register is the single source of truth for display-management claims; marketing, packaging, and the tracker derive from row dispositions, never the reverse.
- Feasibility work (virtual displays, EDID, disconnect) proceeds in parallel without blocking or contaminating the Supported Core.
- Rows that cannot reach `supported` without new public Apple API (for example Night Shift for TVs) stay honestly visible as `unavailable`.
- `script/verify_release.sh` runs the display validator, so baseline drift, premature claims, missing safety gates, or a private-SPI row marked supported fail release verification closed.

## Alternatives rejected

- A second live tracker or any denominator above 100 — violates the one-canonical-model contract.
- DDC, virtual displays, or private APIs inside the supported core — collapses the safety boundary.
- A generic shell escape hatch for display control — bypasses the typed contract; rejected permanently.
- Automatic unconfirmed hardware changes on system events — automation applies only to configurations the user explicitly pre-approved.
