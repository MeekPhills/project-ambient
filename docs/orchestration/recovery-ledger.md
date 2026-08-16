# Recovery ledger

Snapshot: 2026-08-15, from the SOL parent orchestrator verified handoff, updated by the WS-DC-001 drafting session.

| ID | Objective | State | Next action |
|---|---|---|---|
| PA-001 | Preserve canonical tracker truth (schema v3, 20/100; M0 8/8, M1 5/14, M2 1/12, M3 0.5/20, M4 3/14, M5 0/12, M6 0/7, M7 0.5/6, M8 2/7) | Verified | No change until schema-v4 passes its activation checklist |
| PA-002 | Finish Static-first onboarding/import (issue #37) | Uncommitted draft on the owner's Mac | Mac-local only — see constraints. Inspect the dirty diff, run focused Swift tests with isolated caches, commit only safe scoped work |
| PA-003 | Certify base-M4 efficiency (issue #28) | Planned, zero credit | Blocked on functional implementation and measurable fixtures |
| PA-004 | Local-first in-app chat (issue #29) | Planned, zero credit | Blocked on stable typed command contracts |
| PA-005 | BetterDisplay-class display management | Cleared with explicit owner approval 2026-08-15: governance issue #41 and draft PR #40 published | Non-author review of PR #40; ADR 0003 stays Proposed until accepted at merge |
| PA-006 | Preserve protected checkout (`~/Library/Mobile Documents/com~apple~CloudDocs/Codename Ambiant`) | Safe | Never reset, clean, stash, switch, overwrite, or integrate from it |

## Session constraints recorded 2026-08-15

- The WS-DC-001 drafting session ran in a cloud container without access to the owner's Mac. The
  protected checkout and the isolated #37 worktree
  (`../project-ambient-m1-onboarding-import`, branch `feat/37-static-onboarding-import`, base
  `97affa0b49cbcab239dca0873d04ae13f8bd2951`, three untracked Swift files) were untouched and remain
  the only place #37 implementation may continue. The prior focused Swift test hung, was terminated,
  and earned no evidence.
- These artifacts were first drafted in a private staging repository and then ported here; the port
  changed structure to repository conventions, not substance. Row content is identical (115 rows,
  40 free / 37 Pro / 38 cross-cutting).
- One correction made during the port: the orchestrator handoff's milestone list omitted M2 and
  M5–M8; the repository manifest reconciles 20/100 exactly, so the schema-v4 proposal now uses the
  real nine-milestone model.

## Standing prohibitions (unchanged)

No tracker credit changes · no protected-checkout operations · no private SPI in the supported
product · no arbitrary shell escape hatch · no unconfirmed automatic hardware changes · no
publication of gated material without explicit owner approval.
