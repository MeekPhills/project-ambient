# M0 issue #17 repository baseline

**Evidence date:** 2026-08-13

**Repository:** `MeekPhills/project-ambient`

**Branch:** `verify/m0-repository-baseline`

**Verified commit:** `e46979ec163239887c2eff04edbf7bb3109dbd4d`

**Issue:** [#17 — Verify repository baseline and release-integrity commands](https://github.com/MeekPhills/project-ambient/issues/17)

## Result

The locked JavaScript installs and focused MCP and site checks are reproducible on this machine. The documented native and aggregate release baselines are **not yet green**: SwiftPM repeatedly stalled before compilation with its default shared manifest/cache behavior, and the bounded local-cache diagnostic reached compilation but stopped after Swift reported that `AmbientEngine.swift` had changed during the build. Git showed a clean worktree and the file modification time predated the build, so this run does not establish a product-source regression.

No completion or production-readiness credit should be awarded from this report. Issue #17 remains a release-integrity gate until the Swift build and aggregate verifier pass on a machine with adequate free space and a stable SwiftPM environment.

## Environment

| Component | Observed value |
| --- | --- |
| Host | Apple silicon (`arm64`) |
| macOS | 26.5.2 (25F84) |
| Xcode | 26.6 (17F113) |
| Swift | 6.3.3 (`swiftlang-6.3.3.1.3`) |
| Node.js | 24.18.0 |
| npm | 11.16.0 |
| Git | 2.50.1 (Apple Git-155) |
| Initial free space before installs | about 1.8 GiB |
| Lowest observed free space | about 352 MiB |

The host satisfies the documented minimum versions, but the run began under severe disk pressure. Generated dependency/build directories were left in place; no cleanup or destructive operation was performed.

## Command evidence

| Command | Result | Evidence / qualification |
| --- | --- | --- |
| `npm --prefix services/mcp ci` | PASS | Installed 124 packages; npm reported 0 vulnerabilities. npm 11 warned that install scripts for `esbuild@0.28.2` and `fsevents@2.3.3` were not covered by `allowScripts`. |
| `npm --prefix services/mcp run check` | PASS | TypeScript no-emit check exited 0. |
| `npm --prefix services/mcp test` | PASS with expected skips | The restricted run failed ten loopback-listener tests with `listen EPERM 127.0.0.1`. Re-running the exact test command with local-loopback permission passed 94, failed 0, skipped 2. The skips are the built-native `ambientctl` contract smoke and live PostgreSQL suite without `TEST_POSTGRES_URL`. |
| `npm --prefix apps/site ci` | PASS with security gap | Installed 471 packages. npm reported 20 known dependency vulnerabilities: 1 low, 4 moderate, and 15 high. No automatic or forced dependency mutation was attempted. npm 11 also reported seven packages with unapproved install scripts. |
| `npm --prefix apps/site run build` | PASS | Vinext built all five environments and listed the expected routes. It classified several routes as unknown because its static analysis cannot detect all dynamic API usage; this was emitted as an informational limitation. |
| `npm --prefix apps/site test` | PASS | The script rebuilt the site, then passed 12 of 12 rendered-route/status tests with 0 skips. |
| `swift build --package-path apps/macos` | BLOCKED | In the restricted environment it failed because SwiftPM/Clang could not write user cache paths. With normal cache access, the exact command remained idle for more than four minutes before compilation and was interrupted. |
| `./script/verify_release.sh` | BLOCKED | The verifier reached its first Swift build command and then remained idle before compilation. A second run with normal macOS process/cache access behaved the same and was interrupted. MCP, site, and secret-scan stages therefore did not execute inside the aggregate script. |
| bounded Swift diagnostic | FAIL, environment suspected | `swift build --package-path apps/macos --disable-sandbox --manifest-cache local --disable-dependency-cache --cache-path apps/macos/.build/codex-cache --config-path apps/macos/.build/codex-config --security-path apps/macos/.build/codex-security --jobs 2` bypassed the shared-cache stall and reached steps 15/21, then failed twice with `AmbientEngine.swift was modified during the build`. `git status` remained clean and the file timestamp predated the build. |

## Release-integrity gaps and risks

1. **High — native/aggregate baseline is unproven.** The release verifier cannot earn a green result until Swift build and test complete. Owner: native/release integrator. Mitigation: repeat on a clean machine or stable CI runner with sufficient disk, using the exact documented command first; preserve logs and process samples if it stalls.
2. **High — website dependency audit is not release-clean.** A locked clean install reports 15 high-severity advisories. Owner: site dependency maintainer plus security reviewer. Mitigation: triage the audit tree in a separate issue, update dependencies through reviewed changes, and rerun build/tests and `npm audit`. Do not use `npm audit fix --force` as an unattended release step.
3. **Medium — npm install-script policy is unresolved.** npm 11 withheld or flagged install scripts in both workspaces. Owner: release/security maintainer. Mitigation: inspect the exact transitive packages and record a reviewed `allowScripts` policy or prove the packages function without those scripts.
4. **Medium — two MCP integration suites remain external gates.** The native envelope smoke awaits a built `ambientctl`, and the real PostgreSQL suite requires a disposable `TEST_POSTGRES_URL` credential with documented test-only privileges. Owner: native/MCP QA. Mitigation: run both only in an isolated test environment; never substitute production credentials.
5. **Medium — severe disk pressure can invalidate build evidence.** The host reached about 352 MiB free during the Swift attempts. Owner: QA/operator. Mitigation: require and record a conservative free-space preflight on the next clean run before dependency installation or compilation.
6. **Low — sandbox-only failures can look like product regressions.** Loopback tests and default Swift caches require capabilities denied by the restricted runner. Owner: QA. Mitigation: retain the restricted failure as diagnostic evidence, then rerun the exact command with only the required permission and report both outcomes as done here.

## Reproduction smoke test

From a clean checkout of the verified commit on macOS with Xcode/Swift and Node/npm versions satisfying the repository requirements:

```bash
git status --short
npm --prefix services/mcp ci
npm --prefix apps/site ci
./script/verify_release.sh
npm --prefix apps/site test
git status --short
```

Expected success evidence:

- both `git status --short` calls are empty;
- the aggregate verifier completes Swift build/test, MCP check/test/build, site build, and secret scan, then prints `Project Ambient release verification passed.`;
- MCP loopback tests run with local bind permission;
- the native contract test runs after `ambientctl` is built;
- the site reports 12 passing rendered/status tests;
- npm audit findings and install-script policy are separately dispositioned rather than hidden by passing builds.

## Exact next action

Run the reproduction smoke test on a clean machine or CI runner with ample free space. If the exact Swift command stalls again, capture a process sample and SwiftPM diagnostic log, then open a dedicated toolchain/build-system issue without changing product code. If it passes, attach the full aggregate output to #17 and route the site audit and npm install-script findings to owned security/dependency issues before asking for #17 acceptance.
