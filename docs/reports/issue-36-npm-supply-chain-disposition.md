# Issue #36 npm supply-chain disposition

**Captured:** 2026-08-23

**Baseline:** `84ced53b980961b9db7e62daa852e45d522127de`

**Branch:** `chore/36-site-dependency-policy`

**Issue:** [#36](https://github.com/MeekPhills/project-ambient/issues/36)

**Tracker:** zero credit; canonical schema v3 remains 20/100

## Security boundary

An npm lifecycle script executes package-controlled code during dependency
installation. Project Ambient therefore treats every locked npm workspace as a
deny-by-default boundary: lifecycle scripts are disabled by workspace-local
configuration and by explicit flags in CI, release packaging, documentation,
and container installs. There are no package exceptions.

Repository discovery covers root and nested lockfiles even below generated-name
directories, case-folds npm's reserved lock/config names, rejects lock/config
symlinks, and rejects `npm-shrinkwrap.json` because npm would give it precedence
over the governed `package-lock.json`. Command discovery covers workflow shell
steps, local composite actions, shell sources, documentation, and repository
JavaScript/TypeScript sources outside generated dependency/build trees.
Lifecycle-capable npm commands require one unambiguous true
`--ignore-scripts` flag; false, abbreviated, duplicate, alias, chained, quoted,
escaped, variable, programmatic, folded-multiline, and path-qualified forms fail
closed. Root install/pack/publish lifecycle hooks and transient `npx` execution
are prohibited. The MCPB command uses the exact committed tooling lock and an
allowlisted process environment with isolated npm home, cache, user config, and
global config. Release `npm pack` carries the explicit deny flag, and one exact
active policy-validator invocation immediately before it rejects install,
prepare, pack, dependency, and publish lifecycle hooks; this is required because
npm versions do not suppress every prepare-family hook consistently during
`npm pack`. The active gate sources and MCPB builder are byte-hash pinned, so a
commented, unreachable, disabled-workflow, or otherwise substituted invocation
cannot satisfy the policy.

Moderate, high, or critical advisories fail the release-integrity job. The
machine-checked policy, lock digests, exact install-script inventory, captured
audit counts, and residual disposition are in
`docs/security/npm-supply-chain-policy.json` and are validated by
`script/validate_npm_supply_chain.mjs`.

## Audit result

| Locked workspace | Baseline | Corrected tree | Disposition |
|---|---:|---:|---|
| `apps/site` | 20 total: 15 high, 4 moderate, 1 low | 0 | Compatible lock refreshes remove every reported path without a forced major migration. |
| `services/mcp` | 0 | 0 | Clean. |
| `script/mcpb-tooling` | 5 total when first audited in this review: 1 high, 4 low | 0 | The single `tmp` path and its four propagated package records are removed by a tested targeted override. |

The full current `npm audit --package-lock-only --json` output and dependency
paths are posted on issue #36. The corrected release threshold command is
`npm audit --package-lock-only --audit-level=moderate`; it passes in all three
workspaces.

## High and moderate path remediation

- Direct site tooling moved to patched compatible releases: React and
  `react-server-dom-webpack` 19.2.8, Vite 8.2.2, vinext 1.0.0-beta.8,
  `@vitejs/plugin-rsc` 0.5.34, Cloudflare's Vite plugin 1.53.1, and Wrangler
  4.125.0. This removes the React server-function denial-of-service, Vite
  development-server, `image-size`, `sharp`, `undici`, `ws`, Wrangler, and
  Miniflare paths reported against the old lock.
- TypeScript ESLint 8.67.0 plus an intentional lock refresh moves both
  `brace-expansion` instances, `fast-uri`, and `js-yaml` to patched releases.
  A compatible Babel-family lock refresh selects `@babel/core@7.29.7`, removing
  the former development-only low source-map finding without a Babel 8 migration.
- `drizzle-kit@0.31.10` still declares the deprecated
  `@esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild@~0.18.20`
  chain. A narrow npm override binds only that nested esbuild to 0.25.12. The
  ordinary Drizzle config check and a fresh SQLite migration generation both
  pass through that boundary.
- Release-only MCPB tooling keeps the current supported
  `@anthropic-ai/mcpb@2.1.2` and overrides only its
  `@inquirer/prompts -> @inquirer/editor -> external-editor -> tmp` leaf to
  `tmp@0.2.7`. A fresh MCP bundle validates and packs successfully.

No unattended `npm audit fix --force`, blanket legacy-peer bypass, or advisory
suppression is used.

Each release gate obtains fresh npm audit JSON for all three workspaces and
passes it directly to the policy validator. Severity counts and every retained
advisory's GHSA, package, node path, severity, and workspace must match the
governed rows exactly; the schema supports multiple advisory/node identities
for one package while rejecting duplicate complete identities. Fabricated,
duplicate, misplaced, or missing residuals fail even when the moderate
threshold itself would exit successfully.

## Residual findings

None. The governed residual list is empty and all three current audit reports
reconcile to zero. Any future advisory must either be removed or recorded by
its complete machine-checked identity; an unrecorded nonzero result fails.

## Install-script inventory

The three lockfiles declare seven script-capable package entries: five in the
site workspace, two in MCP, and none in MCPB tooling. All seven are listed by
exact lock path, version, development/optional flags, and the disposition
`disabled-by-default-no-exception`. Any lock drift, new script-capable package,
exception, weakened audit threshold, unknown policy field, or tracker change
fails the offline validator.

## Verification

- Three clean `npm ci` installs reported `ignore-scripts=true`; site installed
  467 packages, MCP 124, and MCPB tooling 54 without lifecycle execution.
- `node script/validate_npm_supply_chain.mjs`: passed; three workspaces, seven
  denied packages, zero exceptions, zero findings at every severity, and 95
  fail-closed tamper cases. Fresh audit JSON for all three workspaces reconciled
  exactly to the governed zero counts and empty residual list.
- `npm test` in `apps/site`: production build passed and 12/12 rendered-route
  tests passed with Vite 8.2.2.
- `drizzle-kit check` and isolated `drizzle-kit generate`: passed; no schema
  changes were produced.
- MCP `check`, tests, and build: passed; 95 tests passed and one PostgreSQL
  integration test skipped because `TEST_POSTGRES_URL` was not configured.
- MCPB 2.1.2 validated and packed a 3.4 MB bundle from the corrected locks. A
  hostile parent npm registry/config/token environment was ignored by the
  allowlisted packaging process, which still installed from the canonical
  registry and produced the bundle.
- Moderate-or-higher audit threshold: passed in all three workspaces with zero
  findings.
- `./script/verify_release.sh`: passed, including 69 Swift tests, all static
  contracts and native probe checks, 95 MCP tests plus the expected database
  skip, TypeScript, and the production site build.
- `bash -n script/verify_release.sh`, Node syntax, JSON parsing, and diff checks
  are merge-gate requirements.

`npm run lint` in the site workspace still reports 14 existing
`@next/next/no-html-link-for-pages` findings in three untouched source files.
The dependency patch neither creates nor hides them; site build/tests and the
repository release gate pass. They require a separate UI/router cleanup rather
than an unrelated change in this security branch.

The exact LF bytes for JSON, shell, workflow, and npm configuration inputs are
declared in `.gitattributes`. MCPB packaging is explicitly supported under Bash
on macOS/Linux (or WSL/Git Bash on Windows); native `cmd.exe` packaging is not
claimed.

CodeQL, secret scan, clean Linux installs, the PostgreSQL-backed MCP test, and
the universal candidate remain exact-head CI gates. This report awards no
tracker credit and changes no product-completion claim.
