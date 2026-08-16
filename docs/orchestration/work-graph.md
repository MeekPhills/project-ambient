# Display-control work graph (WS-DC-001 … WS-DC-011)

Persisted from the verified orchestrator handoff, 2026-08-15. Register rows bind to these
workstreams via `ownerWorkstream` in `docs/product/display-control-capability-register.json`.

## Critical path

```
#37 safe checkpoint (Mac-local)
  → WS-DC-001 governance / parity register / schema / tracker decision   [P0 · this branch]
  → WS-DC-002 topology & stable identity                                 [P0 · read-only]
  → WS-DC-003 transactions, last-known-good, rollback, safe mode         [P0]
  → WS-DC-006 supported public modes                                     [P1]
  → WS-DC-009 typed control plane                                        [P1]
  → WS-DC-010 hardware + base-M4 + privacy/a11y qualification and soak   [P0 release gate]
  → WS-DC-011 packaging split, signed manifests, claim gate              [P0 release gate]
```

## Parallel, non-blocking experimental paths

- **WS-DC-004** software dimming/blackout/OSD, audio targeting, groups/favorites/presets, sync (P1)
- **WS-DC-005** DDC and LG/Samsung/Philips/Yamaha adapters — opt-in, timeout, kill-switch, hardware-qualified (P1)
- **WS-DC-007** virtual displays / EDID / disconnect feasibility — never blocks the Supported Core (P2)
- **WS-DC-008** consent-first PiP and local streaming via ScreenCaptureKit (P2); remote streaming deferred and blocked

## Definitions of done (abbreviated)

| WS | Definition of done |
|---|---|
| 001 | Every 4.3.6 feature owned, version-bound, test-bound, dispositioned; validator green |
| 002 | ID churn, missing/duplicate serials, docks, KVMs, mirroring, sleep/wake resolve conservatively; zero hardware mutation |
| 003 | Failed second-display apply restores the first display without touching wallpaper state; stale topology rejects pre-mutation; bad profile starts safe mode |
| 004 | Control source (software vs hardware) always visible; no sync loops; wrong targets rejected |
| 005 | Adapters opt-in, timeout-bound, cancelable, kill-switchable, locally authenticated, hardware-qualified, removable; experimental until exact hardware evidence passes |
| 006 | No mode exposed unless the OS or display actually reports or qualifies it |
| 007 | Each mechanism ends qualified-experimental, manual-only, unavailable, or supported-with-evidence |
| 008 | Explicit consent, visible capture state, denial path, stop/release, sleep/wake recovery, base-M4 fallback |
| 009 | No free-form command bypasses preview, confirmation, policy, verification, undo, or capability status |
| 010 | Exact machine, macOS, firmware, cable, port, dock, mode, recovery, CPU, memory, wakeup, GPU, network, and storage evidence plus 48–72 hour soak |
| 011 | Signed capability manifests; clean install/update/rollback/uninstall; no unsupported parity claim |

## Initial execution wave

- **Agent A** — issue #37 correction and review (Mac-local only; owns the dirty M1 importer files)
- **Agent B** — WS-DC-001 research artifacts (**complete on this branch**; governance-issue publication still owner-gated)
- **Agent C** — parity fixtures and source crosswalk (unblocked once this branch merges)

Maximum one heavy native build at a time.
