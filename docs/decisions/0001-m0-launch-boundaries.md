# 0001 — M0 launch boundaries

**Status:** Accepted

**Date:** 2026-08-13

**Decision owner:** Project Ambient maintainer

**Tracks:** [#19](https://github.com/MeekPhills/project-ambient/issues/19), [#21](https://github.com/MeekPhills/project-ambient/issues/21)

## Context

The Static → Hybrid → Managed launch design left six decisions open. They must be fixed before task decomposition so platform adapters, packaging, privacy, licensing, and hosted work do not implement conflicting assumptions.

## Decisions

### 1. Shared core

Keep the existing Swift implementation as the macOS reference core. Define versioned, language-neutral schemas and behavioral fixtures for catalog, scenes, rules, capabilities, decision logs, and remote commands. Run a bounded Rust feasibility spike before M5. A rewrite requires measured portability or reliability benefit, a compatibility plan, and an incremental migration path; portability alone is not sufficient.

### 2. Software and media licensing

Keep the local community core under MIT. Hosted operations and genuinely managed commercial capabilities may be separately licensed and operated, but local Static and Hybrid use stays useful and account-free. Software licensing never grants rights to media. Every pack or scene carries independent provenance, attribution, permitted-use, redistribution, territory/term, and removal metadata. Legal-counsel review remains required before final commercial terms; this record is a product boundary, not legal advice.

### 3. First Linux targets

Support GNOME on Wayland and KDE Plasma on Wayland first. Publish exact desktop-environment, compositor, session, packaging, and feature evidence through the capability manifest. X11 is best-effort legacy support unless maintained CI and demand justify promotion. Never infer a capability merely from the platform name `Linux`.

### 4. Managed launch boundary

Ship the open-source community product to GA with a separately gated Managed Preview. The preview must meet its tenant-isolation, entitlement, audit, privacy, support, and recovery acceptance criteria, but it is not represented as enterprise GA. Enterprise GA follows preview evidence and any external identity or compliance gates.

### 5. Creator and marketplace sequence

Ship creator pack manifests, validation, attribution, local installation, update, and removal in M2. Defer hosted catalog transactions, payouts, and marketplace economics until the local library and M4 automation/resilience contracts are stable. No pack may expose personal source media or imply redistribution rights that its manifest does not grant.

### 6. Diagnostics and retention

Diagnostics are off by default and require explicit opt-in. Redaction occurs locally. Prohibited fields include media contents, thumbnails, filenames, local paths, prompts, credentials, precise location, and unrelated application data. Hosted diagnostics default to 30-day retention with export and deletion. Every event is allowlisted, documented, inspectable, and attributable to a support or reliability purpose. Local-only diagnostics remain available without an account.

## Tracker reconciliation

The existing `apps/site/app/status/status-manifest.json` remains the only weighted completion tracker. Its 45-point native/distribution, 45-point MCP/marketplace, and 10-point launch/traction phases and the historical 49.75/100 audit remain intact until an evidence-backed scope migration is accepted.

The proposed M0–M8 shares (`8/14/12/20/14/12/7/6/7`) are accepted as planning-capacity guidance, not as a second completion percentage. Issue #16 must map every milestone gate to canonical task IDs, identify expanded Windows/Linux/mobile/Managed scope that is not in the current denominator, and propose one versioned migration of the canonical manifest. That migration must preserve the historical baseline, keep total weight at 100, pass status and rendered-site validation, and receive independent review before implementation earns credit.

## Consequences

- M0 planning may proceed using these boundaries.
- Product implementation remains gated on the accepted task/dependency plan in #16 and verified baseline in #17.
- #21 still owns detailed rights fields, contributor policy, commercial packaging, and counsel-review flags.
- #20 owns the capability schema; #18 owns Aerial parity completeness.
- Any reversal requires a superseding decision record and updated issue dependencies.
