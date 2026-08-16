# Tracker schema v4 — migration proposal (NOT ACTIVE)

**Status:** Proposal only. Schema v3 (canonical 20/100, Sites version 19) remains the live tracker.
Activation requires, in order: independent review → merge → deployment → public smoke pass. Until all
four complete, no tracker credit changes and the public status endpoint keeps serving v3.

## Invariants (accepted tracker contract)

1. Exactly **one** canonical live model of exactly **100 points**. Never a second live tracker, never
   a denominator above 100.
2. Prior models are immutable history: the 49.75/100 model and schema-v2 remain preserved in the
   manifest history exactly as v3 preserves them today; v3 itself becomes immutable history at
   activation.
3. Earned credit carries over losslessly. Current v3 earned state:
   M0 8/8 · M1 5/14 · M2 1/12 · M3 0.5/20 · M4 3/14 · M5 0/12 · M6 0/7 · M7 0.5/6 · M8 2/7 = **20/100**.
   (The orchestrator handoff listed only M0/M1/M3/M4; the repository manifest is authoritative and
   reconciles exactly.)
4. The display expansion earns **0 points at activation** — governance research produces artifacts,
   not implementation credit. The parity register itself carries no credit fields (validator-banned).

## Proposed v4 weights (100 points)

No milestone may drop below its already-earned points. M0 stays at 8 (fully earned).

| Milestone | v3 weight | v3 earned | v4 proposed | Delta |
|---|---|---|---|---|
| M0 Foundation | 8 | 8 | 8 | 0 |
| M1 Guided Static Foundation | 14 | 5 | 12 | −2 |
| M2 | 12 | 1 | 8 | −4 |
| M3 | 20 | 0.5 | 12 | −8 |
| M4 Performance / base-M4 | 14 | 3 | 12 | −2 |
| M5 | 12 | 0 | 7 | −5 |
| M6 | 7 | 0 | 5 | −2 |
| M7 | 6 | 0.5 | 5 | −1 |
| M8 Packages/channels | 7 | 2 | 5 | −2 |
| **M9 Display control (new)** | — | — | **26** | +26 |
| **Total** | **100** | **20** | **100** | 0 |

Post-activation readiness remains exactly **20/100**.

### M9 display-control breakdown (26 points)

| Workstream | Points | Earned when |
|---|---|---|
| WS-DC-001 governance / parity register accepted | 2 | Register + validator merged; governance issue published with owner approval |
| WS-DC-002 topology & stable identity | 4 | Identity churn matrix green |
| WS-DC-003 transactions, last-known-good, recovery | 5 | Rollback and safe-mode smoke green |
| WS-DC-004 software controls & sync | 3 | Control-source visibility and no-loop proofs |
| WS-DC-006 supported public modes | 4 | Reported-mode transactions qualified |
| WS-DC-009 typed control plane | 3 | Contract-identical results across UI/CLI/App Intents/chat/MCP |
| WS-DC-010 qualification & base-M4 gate | 3 | Hardware matrix + soak evidence |
| WS-DC-011 packaging & claim gate | 2 | Signed manifests + install-lifecycle evidence |

Experimental adapters (WS-DC-005 DDC/network, WS-DC-007 virtual/EDID/disconnect, WS-DC-008
PiP/streaming) intentionally earn **0** canonical points: optional capabilities must never be
load-bearing for the readiness score. Their progress is reported narratively outside the model.

## Activation checklist (all required, in order)

- [ ] Owner approves publishing the display-control governance issue
- [ ] WS-DC-001 artifacts merged after independent architecture, licensing, privacy, and tracker review
- [ ] The carry-over table above re-verified against the live `status-manifest.json` at migration time
- [ ] `docs/product/implementation-plan.json` updated in the same PR (stays acyclic, exactly 100 points, passes `validate_implementation_plan.mjs`)
- [ ] v4 manifest deployed with v2/v3 history immutable
- [ ] Public status endpoint smoke-tested serving v4 (score, arithmetic, history, ETA, checks)
- [ ] Only then: v3 marked historical
