# M1 Static import clean-account smoke

**Date:** 2026-08-22  
**Issue:** [#37](https://github.com/MeekPhills/project-ambient/issues/37)  
**Branch:** `feat/37-clean-account-evidence`  
**Tracker:** zero credit; canonical schema v3 remains 20/100

## Measured slice

`CleanAccountSmokeTests.testCleanAccountStaticImportReachesApplyWithoutPriorState` starts with a newly created state directory and an empty fixture library. It then:

1. imports one supported still and one unsupported file through the typed `.importMedia` command;
2. verifies the source remains in place, one asset is cataloged, and the unsupported file is actionable;
3. applies the imported still through a fake wallpaper boundary, proving the engine reaches the apply transition without touching real desktop state;
4. reloads from the persisted state and verifies the asset and two request-ledger entries survive restart.

This is an isolated clean-state vertical-slice smoke, not a claim of a pristine macOS user account or dual-display qualification. It deliberately uses a fake wallpaper adapter so CI and local verification cannot change the user's desktop.

## Verification

- `swift test --disable-sandbox --package-path apps/macos --filter CleanAccountSmokeTests`: required focused result recorded on the issue/PR.
- Full Swift suite and exact-head CI remain required before merge.

## Remaining #37 / #28 gates

- Real clean-account install and GUI onboarding smoke on the reference Mac mini.
- Base-M4 1,000-item mixed fixture, dual-display 8K apply, CPU/RSS/wakeup/network/storage measurements, and memory/thermal/decoder failure evidence.
- 48–72 hour clean-machine soak.

No metric is claimed here without measurement on the reference fixture; no private API, persistent model service, network upload, or tracker change is introduced.
