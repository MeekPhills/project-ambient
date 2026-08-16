# Display-control risk register

**Date:** 2026-08-15 · **Owner:** WS-DC-001 · **Baseline:** BetterDisplay 4.3.6 (frozen, tag `046b59f8…`)

Severity is impact if realized. Every mitigation maps to a validator-enforced rule or claim gate in `docs/product/display-control-capability-register.json`; run `node script/validate_display_control.mjs` to confirm the anchors hold.

| ID | Risk | Severity | Likelihood | Mitigation | Register anchor |
|---|---|---|---|---|---|
| R-01 | Private Apple SPI ships in the Supported Core binary and breaks on an OS update | Critical | Medium without enforcement | Validator rejects `supported` rows carrying `private-spi-risk`/`os-undocumented` basis; SPI stays in adapters or blocked | BD-POL-004 |
| R-02 | EDID override renders a display unusable | Critical | Low | Disposition `blocked` pending explicit owner decision; rollback-proof gate before any feasibility work | BD-EDID-002/003 |
| R-03 | DDC write (input switch, power) strands the user on a dead input or powered-off display | High | Medium | Confirmation + revert window, timeout, kill switch, hardware-matrix qualification | BD-DDC-006/007 |
| R-04 | Display transaction leaves a broken arrangement after a failed apply | High | Medium | Transaction engine with preview/verify/rollback and independent last-known-good; stale topology rejects pre-mutation | BD-MODE-010, BD-SET-005 |
| R-05 | A bad stored profile makes the app or desktop unusable at launch | High | Low | Safe mode reachable without a working display configuration; clean reset/removal | BD-SET-004 |
| R-06 | Screen capture (PiP/streaming) runs without the user realizing it | High | Low | ScreenCaptureKit only, explicit consent, visible capture state, deterministic stop/release including sleep/wake | BD-PIP-001..008 |
| R-07 | Remote streaming becomes an unauthenticated network exfiltration path | Critical | Low | Disposition `blocked`; separate threat model and owner decision before any work | BD-PIP-009 |
| R-08 | Sync loops between grouped displays (software vs hardware channel fighting) | Medium | Medium | Single-writer sync engine with loop prevention; hardware channel only via adapter gates | BD-SYNC-001/003/004 |
| R-09 | Vendor network control (TV/AVR) accepts commands from other LAN actors | High | Low | Local auth, opt-in pairing, timeout, kill switch per connector | BD-NET-001..004 |
| R-10 | Automatic reassertion (mirror/layout/config protection) mutates hardware state the user did not approve | High | Medium | Automation only for explicitly pre-approved configurations; everything else confirms first | BD-POL-002 |
| R-11 | Clean-room breach: BetterDisplay proprietary code, assets, or trade dress leaks into the implementation | Critical | Low | Clean-room boundary in register + ADR 0003; independent licensing review in WS-DC-001 definition of done | cleanRoomBoundary |
| R-12 | Resource footprint breaks the base-M4 (16 GB/256 GB) contract (#28) | Medium | Medium | m4-resource and 48–72 hour soak gates on every supported claim; capture pipelines carry explicit fallbacks | BD-QUAL-001 |
| R-13 | Marketing claims "full BetterDisplay replacement" while rows remain unqualified | High | Medium without enforcement | `launchGate.fullReplacementClaim` hard-enforced false while any row is unqualified; the claim row itself is blocked on owner decision | BD-PKG-004 |
| R-14 | Tracker corruption: the expansion inflates or double-counts the canonical 100-point model | Medium | Medium | Schema-v3 stays immutable; schema-v4 activates only after review, merge, deploy, and public smoke; register bans credit fields | tracker-schema-v4-proposal |
| R-15 | A privileged helper is introduced casually as a hardware-access shortcut | High | Low | Disposition `blocked`; any helper proposal is a manual-only owner decision with security review | BD-POL-003 |
| R-16 | Display identity churn (docks, KVMs, duplicate serials) applies settings to the wrong display | High | Medium | Conservative identity resolution — ambiguity never guesses; read-only until identity is certain | BD-DIS-002 |
| R-17 | Gamma/dimming state sticks after a crash (dark or tinted screen persists) | Medium | Medium | Gamma restore on quit/crash via the recovery path; blackout always keeps an escape hatch | BD-DIM-004/007 |

## Standing owner decisions required (manual-only)

Publication approvals for governance material; physical MSI MAG321UX/321UPX and Dell U2723QE testing; cable/dock/KVM/firmware inventory; experimental/private-SPI capability decisions; signing/notarization identities; Screen Recording and Accessibility permission testing; distribution channel; any privileged helper; remote streaming; the public replacement marketing claim.
