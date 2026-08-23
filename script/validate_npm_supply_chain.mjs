#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = "docs/security/npm-supply-chain-policy.json";
const EXPECTED_WORKSPACES = ["apps/site", "script/mcpb-tooling", "services/mcp"];
const NPMRC_BYTES = "ignore-scripts=true\n";
const DISPOSITION = "disabled-by-default-no-exception";
const SEVERITIES = ["info", "low", "moderate", "high", "critical", "total"];
const IGNORED_DISCOVERY_DIRECTORIES = new Set([".git", ".build", ".next", ".vinext", ".wrangler", "coverage", "dist", "node_modules"]);

function readText(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJSON(path) {
  return JSON.parse(readText(path));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
}

function discoverRepositoryFiles(directory = ROOT, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!IGNORED_DISCOVERY_DIRECTORIES.has(entry.name)) discoverRepositoryFiles(join(directory, entry.name), found);
      continue;
    }
    if (entry.isFile()) found.push(relative(ROOT, join(directory, entry.name)).split(sep).join("/"));
  }
  return found;
}

function validateDiscoveredLockfiles(discovered, errors) {
  const expected = EXPECTED_WORKSPACES.map((workspace) => `${workspace}/package-lock.json`);
  if (JSON.stringify(discovered) !== JSON.stringify(expected)) {
    errors.push("repository package-lock.json discovery must match the three governed workspaces exactly");
  }
}

function installCommandIsDenied(line) {
  const command = line.trim();
  const installPattern = /^(?:run:\s*)?npm(?:\s+--prefix\s+\S+)?\s+(?:ci|install)\b/;
  return !installPattern.test(command) || command.includes("--ignore-scripts");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, at, errors) {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    errors.push(`${at} keys must be exactly ${wanted.join(", ")}`);
    return false;
  }
  return true;
}

function canonicalWorkspaceNames(rows, at, errors) {
  if (!Array.isArray(rows)) {
    errors.push(`${at} must be an array`);
    return [];
  }
  const names = rows.map((row) => row?.path);
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_WORKSPACES)) {
    errors.push(`${at} must contain the three locked workspaces once in canonical order`);
  }
  return names;
}

function validatePolicyShape(policy) {
  const errors = [];
  if (!exactKeys(policy, ["schemaVersion", "issue", "scope", "installPolicy", "auditPolicy", "tracker"], "$", errors)) return errors;

  if (policy.schemaVersion !== 1) errors.push("$.schemaVersion must equal 1");
  if (policy.issue !== "https://github.com/MeekPhills/project-ambient/issues/36") errors.push("$.issue must bind GitHub issue #36 exactly");
  if (policy.scope !== "locked-npm-workspaces") errors.push("$.scope must remain locked-npm-workspaces");

  const install = policy.installPolicy;
  if (exactKeys(install, ["default", "mechanism", "npmrcBytes", "exceptions", "workspaces"], "$.installPolicy", errors)) {
    if (install.default !== "deny-lifecycle-scripts") errors.push("$.installPolicy.default must deny lifecycle scripts");
    if (install.mechanism !== "workspace-npmrc-and-explicit-cli-flag") errors.push("$.installPolicy.mechanism must retain both controls");
    if (install.npmrcBytes !== NPMRC_BYTES) errors.push("$.installPolicy.npmrcBytes must be the exact closed configuration");
    if (!Array.isArray(install.exceptions) || install.exceptions.length !== 0) errors.push("$.installPolicy.exceptions must remain empty");
    canonicalWorkspaceNames(install.workspaces, "$.installPolicy.workspaces", errors);
    for (const [index, workspace] of (install.workspaces ?? []).entries()) {
      const at = `$.installPolicy.workspaces[${index}]`;
      if (!exactKeys(workspace, ["path", "lockfileSHA256", "installScriptPackages"], at, errors)) continue;
      if (!/^[a-z0-9][a-z0-9./-]*$/.test(workspace.path ?? "") || workspace.path.includes("..")) errors.push(`${at}.path must be a repository-relative workspace`);
      if (!/^[a-f0-9]{64}$/.test(workspace.lockfileSHA256 ?? "")) errors.push(`${at}.lockfileSHA256 must be lowercase SHA-256`);
      if (!Array.isArray(workspace.installScriptPackages)) {
        errors.push(`${at}.installScriptPackages must be an array`);
        continue;
      }
      const seen = new Set();
      for (const [packageIndex, entry] of workspace.installScriptPackages.entries()) {
        const entryAt = `${at}.installScriptPackages[${packageIndex}]`;
        if (!exactKeys(entry, ["path", "version", "dev", "optional", "disposition"], entryAt, errors)) continue;
        if (typeof entry.path !== "string" || !entry.path.startsWith("node_modules/") || entry.path.includes("..")) errors.push(`${entryAt}.path must be a node_modules lock path`);
        if (seen.has(entry.path)) errors.push(`${entryAt}.path must be unique`);
        seen.add(entry.path);
        if (typeof entry.version !== "string" || entry.version.length === 0) errors.push(`${entryAt}.version must be non-empty`);
        if (typeof entry.dev !== "boolean" || typeof entry.optional !== "boolean") errors.push(`${entryAt} flags must be booleans`);
        if (entry.disposition !== DISPOSITION) errors.push(`${entryAt}.disposition must deny execution without exception`);
      }
    }
  }

  const audit = policy.auditPolicy;
  if (exactKeys(audit, ["command", "failAtOrAbove", "capturedAt", "workspaces", "residualFindings"], "$.auditPolicy", errors)) {
    if (audit.command !== "npm audit --package-lock-only --audit-level=moderate --json") errors.push("$.auditPolicy.command must retain the moderate release gate");
    if (audit.failAtOrAbove !== "moderate") errors.push("$.auditPolicy.failAtOrAbove must equal moderate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(audit.capturedAt ?? "")) errors.push("$.auditPolicy.capturedAt must be an ISO date");
    canonicalWorkspaceNames(audit.workspaces, "$.auditPolicy.workspaces", errors);
    for (const [index, workspace] of (audit.workspaces ?? []).entries()) {
      const at = `$.auditPolicy.workspaces[${index}]`;
      if (!exactKeys(workspace, ["path", "counts"], at, errors)) continue;
      if (exactKeys(workspace.counts, SEVERITIES, `${at}.counts`, errors)) {
        for (const key of SEVERITIES) {
          if (!Number.isInteger(workspace.counts[key]) || workspace.counts[key] < 0) errors.push(`${at}.counts.${key} must be a non-negative integer`);
        }
        const subtotal = ["info", "low", "moderate", "high", "critical"].reduce((sum, key) => sum + (workspace.counts[key] ?? 0), 0);
        if (workspace.counts.total !== subtotal) errors.push(`${at}.counts.total must equal the severity sum`);
        if (workspace.counts.moderate !== 0 || workspace.counts.high !== 0 || workspace.counts.critical !== 0) errors.push(`${at} retains a release-blocking advisory`);
      }
    }
    if (!Array.isArray(audit.residualFindings)) {
      errors.push("$.auditPolicy.residualFindings must be an array");
    } else {
      for (const [index, finding] of audit.residualFindings.entries()) {
        const at = `$.auditPolicy.residualFindings[${index}]`;
        if (!exactKeys(finding, ["advisory", "package", "nodePath", "severity", "workspace", "disposition", "reason"], at, errors)) continue;
        if (!/^GHSA-[a-z0-9-]+$/.test(finding.advisory ?? "")) errors.push(`${at}.advisory must be a GHSA identifier`);
        if (finding.severity !== "low") errors.push(`${at}.severity may retain only low findings`);
        if (!EXPECTED_WORKSPACES.includes(finding.workspace)) errors.push(`${at}.workspace is unknown`);
        if (typeof finding.nodePath !== "string" || !finding.nodePath.startsWith("node_modules/")) errors.push(`${at}.nodePath must be a dependency path`);
        if (finding.disposition !== "tracked-development-only-major-fix-deferred") errors.push(`${at}.disposition must remain explicit`);
        if (typeof finding.reason !== "string" || finding.reason.length < 80) errors.push(`${at}.reason must retain concrete evidence and tradeoff`);
      }
      const retainedLow = (audit.workspaces ?? []).reduce((sum, workspace) => sum + (workspace.counts?.low ?? 0), 0);
      if (audit.residualFindings.length !== retainedLow) errors.push("$.auditPolicy.residualFindings must map every retained low finding once");
    }
  }

  const tracker = policy.tracker;
  if (exactKeys(tracker, ["schema", "score", "creditChange"], "$.tracker", errors)) {
    if (tracker.schema !== 3 || tracker.score !== "20/100" || tracker.creditChange !== 0) errors.push("$.tracker must preserve schema v3 at 20/100 with zero credit change");
  }
  return errors;
}

function lockInstallScriptInventory(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([, value]) => value?.hasInstallScript === true)
    .map(([path, value]) => ({
      path,
      version: value.version,
      dev: value.dev === true,
      optional: value.optional === true,
      disposition: DISPOSITION
    }));
}

function validateRepository(policy) {
  const errors = [];
  const repositoryFiles = discoverRepositoryFiles().sort();
  const discoveredLockfiles = repositoryFiles.filter((path) => path.endsWith("/package-lock.json"));
  validateDiscoveredLockfiles(discoveredLockfiles, errors);
  for (const workspace of policy.installPolicy.workspaces) {
    const lockPath = `${workspace.path}/package-lock.json`;
    const packagePath = `${workspace.path}/package.json`;
    const npmrcPath = `${workspace.path}/.npmrc`;
    if (sha256(lockPath) !== workspace.lockfileSHA256) errors.push(`${lockPath} digest does not match policy`);
    if (readText(npmrcPath) !== NPMRC_BYTES) errors.push(`${npmrcPath} must contain only the exact deny policy`);
    const lock = readJSON(lockPath);
    const packageJSON = readJSON(packagePath);
    if (lock.lockfileVersion !== 3) errors.push(`${lockPath} must use lockfileVersion 3`);
    const rootPackage = lock.packages?.[""];
    if (!rootPackage || rootPackage.name !== packageJSON.name || rootPackage.version !== packageJSON.version) errors.push(`${lockPath} root package does not match package.json`);
    const actualInventory = lockInstallScriptInventory(lock);
    if (JSON.stringify(actualInventory) !== JSON.stringify(workspace.installScriptPackages)) errors.push(`${lockPath} install-script inventory drifted`);
  }

  const controlledInstallFiles = repositoryFiles.filter((path) =>
    (path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path)) ||
    path.endsWith(".sh") ||
    path.endsWith("/Dockerfile") ||
    path === "Dockerfile" ||
    path === "CLAUDE.md" ||
    path === "apps/site/README.md" ||
    path === "services/mcp/README.md"
  );
  for (const path of controlledInstallFiles) {
    for (const [index, line] of readText(path).split("\n").entries()) {
      if (!installCommandIsDenied(line)) errors.push(`${path}:${index + 1} npm install command must explicitly disable lifecycle scripts`);
    }
  }
  const aggregate = readText("script/verify_release.sh");
  if (!aggregate.includes("validate_npm_supply_chain.mjs")) errors.push("script/verify_release.sh must invoke the npm supply-chain validator");
  const workflow = readText(".github/workflows/release-integrity.yml");
  if (!workflow.includes("node script/validate_npm_supply_chain.mjs")) errors.push("release-integrity.yml must invoke the npm supply-chain validator");
  for (const trigger of ["**/package-lock.json", "**/.npmrc", "docs/security/**"]) {
    if (!workflow.includes(`- "${trigger}"`)) errors.push(`release-integrity.yml must trigger on ${trigger}`);
  }
  return errors;
}

function assertInvalid(candidate, label) {
  const shapeErrors = validatePolicyShape(candidate);
  if (shapeErrors.length > 0) return;
  let repositoryErrors = [];
  try {
    repositoryErrors = validateRepository(candidate);
  } catch (error) {
    repositoryErrors = [`repository validation failed closed: ${error.message}`];
  }
  assert.ok(repositoryErrors.length > 0, label);
}

const policy = readJSON(POLICY_PATH);
const tamperCases = [];
function tamper(label, mutate) {
  const candidate = structuredClone(policy);
  mutate(candidate);
  assertInvalid(candidate, label);
  tamperCases.push(label);
}

tamper("unknown top-level field", (value) => { value.claimedComplete = true; });
tamper("lifecycle scripts enabled", (value) => { value.installPolicy.default = "allow"; });
tamper("script exception added", (value) => { value.installPolicy.exceptions.push("esbuild"); });
tamper("workspace dropped", (value) => { value.installPolicy.workspaces.pop(); });
tamper("lock digest malformed", (value) => { value.installPolicy.workspaces[0].lockfileSHA256 = "0"; });
tamper("install-script package omitted", (value) => { value.installPolicy.workspaces[0].installScriptPackages.pop(); });
tamper("install-script execution allowed", (value) => { value.installPolicy.workspaces[0].installScriptPackages[0].disposition = "allowed"; });
tamper("audit threshold weakened", (value) => { value.auditPolicy.failAtOrAbove = "critical"; });
tamper("moderate advisory retained", (value) => { value.auditPolicy.workspaces[0].counts.moderate = 1; value.auditPolicy.workspaces[0].counts.total = 2; });
tamper("residual severity promoted", (value) => { value.auditPolicy.residualFindings[0].severity = "high"; });
tamper("residual path hidden", (value) => { value.auditPolicy.residualFindings[0].nodePath = "unknown"; });
tamper("tracker credit changed", (value) => { value.tracker.creditChange = 1; });
const discoveryErrors = [];
validateDiscoveredLockfiles([...EXPECTED_WORKSPACES.map((workspace) => `${workspace}/package-lock.json`), "unreviewed/package-lock.json"], discoveryErrors);
assert.ok(discoveryErrors.length > 0, "unreviewed lockfile discovery");
tamperCases.push("unreviewed lockfile discovery");
assert.equal(installCommandIsDenied("npm ci"), false, "unguarded install command");
assert.equal(installCommandIsDenied("npm ci --ignore-scripts"), true, "guarded install command");
tamperCases.push("unguarded install command");

const shapeErrors = validatePolicyShape(policy);
assert.deepEqual(shapeErrors, [], `invalid npm supply-chain policy:\n${shapeErrors.join("\n")}`);
const repositoryErrors = validateRepository(policy);
assert.deepEqual(repositoryErrors, [], `npm supply-chain repository drift:\n${repositoryErrors.join("\n")}`);

const disabledCount = policy.installPolicy.workspaces.reduce((sum, workspace) => sum + workspace.installScriptPackages.length, 0);
const residualCount = policy.auditPolicy.residualFindings.length;
console.log(`OK: ${POLICY_PATH} covers ${EXPECTED_WORKSPACES.length} locked workspaces and disables ${disabledCount} install-script packages with no exceptions`);
console.log(`OK: captured audits retain 0 moderate/high/critical findings and ${residualCount} tracked low finding`);
console.log(`self-test: all ${tamperCases.length} tamper cases rejected; validation is fail-closed`);
