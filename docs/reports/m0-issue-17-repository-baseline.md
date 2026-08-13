# M0 issue #17 repository baseline

**Evidence date:** 2026-08-13

**Repository:** `MeekPhills/project-ambient`

**Branch:** `verify/m0-repository-baseline`

**Verified product source:** PR [#34](https://github.com/MeekPhills/project-ambient/pull/34) head `a62b5d41820cecb8047abfa21aee8422adf04c09`, merged as `2f0b925c950db9d145a3949b3fbd53761ab21f88`

**Issue:** [#17 — Verify repository baseline and release-integrity commands](https://github.com/MeekPhills/project-ambient/issues/17)

## Result

The repository baseline is reproducible on clean hosted runners. The exact documented Swift build and test commands pass, the MCP service passes with a disposable PostgreSQL service, the site builds and passes every rendered-route test, and the aggregate verifier completes on macOS with the built `ambientctl` contract. The universal unsigned release candidate, checksums, dependency locks, SBOM, source archive, native app archive, MCP archives, capability contract, rights contract, Aerial parity contract, Homebrew contract, secret scan, and CodeQL gates pass.

The earlier local failure is retained below as environmental evidence, not rewritten as a product failure. That run began with about 1.8 GiB free, reached about 352 MiB, and showed unstable SwiftPM cache behavior. No second heavy local build was launched on the still-constrained Mac. Fresh hosted macOS and Linux runs closed the unproven native, PostgreSQL, and aggregate-command gaps.

This report does not claim signing, notarization, store acceptance, a GA tag, strict Aerial GA parity, or the M4 energy soak. The 20 site dependency advisories and npm install-script policy are explicitly owned by [#36](https://github.com/MeekPhills/project-ambient/issues/36); they remain release-security work and receive no hidden completion credit.

## Clean-runner evidence

| Gate | Exact evidence | Result |
| --- | --- | --- |
| macOS build | `swift build --package-path apps/macos` in [CI run 31753645599](https://github.com/MeekPhills/project-ambient/actions/runs/31753645599), job `macOS companion` | PASS; build completed on `macos-15`. |
| macOS tests | `swift test --package-path apps/macos` in the same job | PASS; 34 tests, 0 failures. |
| MCP install/check/test | `npm ci`, `npm run check`, and `npm test` in the same CI run, job `MCP service`, with pinned PostgreSQL 17.6 | PASS; 100 tests, 99 passed, 0 failed, 1 expected skip because `ambientctl` is a macOS binary. The disposable PostgreSQL integration suite ran. |
| Site install/build/render | `npm ci` and `npm test` in the same CI run, job `Launch site` | PASS; production build plus 12 of 12 rendered-route/status tests. |
| Aggregate release verifier | `./script/verify_release.sh` inside the package-candidate path in [Release integrity run 31753645580](https://github.com/MeekPhills/project-ambient/actions/runs/31753645580) | PASS; printed `Project Ambient release verification passed.` |
| Native MCP envelope | MCP tests inside the aggregate macOS verifier | PASS; built `ambientctl` exercised all ten adapter operations. |
| Aggregate MCP suite | MCP tests inside the aggregate macOS verifier | PASS; 96 tests, 95 passed, 0 failed, 1 expected PostgreSQL skip because that job has no database service. PostgreSQL coverage is supplied by the separate pinned Linux CI service above. |
| Static contracts | Release-integrity static job | PASS; shell syntax, Homebrew, lockfile plans, SBOM generator syntax, capabilities, rights, and the 145-row Aerial parity contract. Strict Aerial `--ga` is intentionally tag-gated and remains closed. |
| Universal candidate | Release-integrity package job | PASS; unsigned candidate plus release-manifest, dependency locks, SBOM, checksums, source/native/MCP/marketplace archives. Candidate mode was correctly ineligible for signing or publication. |
| Security automation | `Secret scan` and [CodeQL run 31753645600](https://github.com/MeekPhills/project-ambient/actions/runs/31753645600) | PASS. |

The two MCP jobs deliberately provide complementary platform evidence: the Linux job supplies a real disposable PostgreSQL service and skips the macOS-only executable; the aggregate macOS job builds and exercises `ambientctl` and skips the unavailable PostgreSQL service. Together they cover both formerly skipped integration paths without introducing production credentials.

## Local diagnostic retained for provenance

The first local attempt used macOS 26.5.2, Xcode 26.6, Swift 6.3.3, Node 24.18, and npm 11.16. Its JavaScript results were valid: MCP installed 124 packages with 0 reported vulnerabilities; TypeScript passed; 94 MCP tests passed with 2 environment-dependent skips; the site built and passed 12 of 12 tests. The site install reported 20 advisories: 1 low, 4 moderate, and 15 high.

The exact local Swift command first stalled before compilation. A bounded local-cache diagnostic reached compile step 15/21, then Swift reported `AmbientEngine.swift was modified during the build` while Git remained clean and the file timestamp predated the run. The original linked worktree is preserved read-only as an evidence snapshot. Its Git index later became unresponsive, so the report resumed in the clean declared replacement clone `../project-ambient-m0-baseline-integrity`; neither checkout was reset or cleaned, and the protected iCloud checkout was untouched.

## Risk disposition

1. **Native and aggregate baseline — closed for M0.** Fresh macOS runners passed the exact native commands and aggregate verifier. Owner: Sol integrator. Evidence: PR #34 CI and Release integrity runs above.
2. **Site dependency advisories — open, no hidden credit.** A clean install reports 15 high, 4 moderate, and 1 low advisories. Owner: site dependency maintainer; security reviewer approves disposition. Follow-up: [#36](https://github.com/MeekPhills/project-ambient/issues/36).
3. **npm install-script policy — open, no hidden credit.** npm 11 identified packages without an explicit script policy. Owner and acceptance test: [#36](https://github.com/MeekPhills/project-ambient/issues/36). No unattended `npm audit fix --force` is authorized.
4. **Native/PostgreSQL combined coverage — closed with split-runner evidence.** The pinned Linux service passes PostgreSQL tests; the macOS aggregate passes the built-native adapter. Owner: MCP/native QA. Neither requires a production credential.
5. **Local disk pressure — mitigated operationally.** The failed local attempt remains non-authoritative. Owner: QA/operator. Heavy native builds require a free-space preflight and only one heavy workload at a time.
6. **Signing, publication, strict parity, and soak — out of this task.** These remain explicit M3/M4/M8 gates and receive zero #17 credit.

## Reproduction smoke test

From a clean checkout on macOS with the repository-supported Xcode/Swift and Node/npm versions:

```bash
git status --short
npm --prefix services/mcp ci
npm --prefix apps/site ci
./script/verify_release.sh
npm --prefix apps/site test
git status --short
```

Expected evidence:

- both Git status checks are empty;
- the aggregate verifier completes Swift build/test, capability/rights/parity validation, MCP check/test/build, site build, and secret scan, then prints `Project Ambient release verification passed.`;
- the built native adapter test passes on macOS;
- the site reports 12 passing rendered/status tests;
- the companion Linux CI job passes the disposable PostgreSQL suite;
- locked release artifacts pass checksum, SBOM, source-identity, and manifest verification;
- dependency advisories and install-script policy remain visible through #36 rather than being hidden by passing builds.

## Definition-of-done decision

The #17 baseline artifact and command evidence are complete, subject to non-author review and same-head PR CI. The earlier machine-capacity failure is resolved by clean-runner evidence. Merge this report only after review confirms every claim and all PR checks pass; only then may the canonical tracker award the one M0 baseline point. Final #10 integration, M4/chat implementation, strict parity, signing, publishing, and the 48–72 hour soak remain separate zero-credit gates.

## Exact next action

Obtain a non-author review of this report and its linked run evidence. Push the rebased report, require same-head CI and CodeQL on PR #24, and merge only if the review and checks pass. Then activate exactly the one #17 M0 point through #10, run the complete M0 validator/risk/cold-start gate, and keep every downstream product requirement at zero until implemented and measured.
