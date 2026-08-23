#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = "docs/security/npm-supply-chain-policy.json";
const EXPECTED_WORKSPACES = ["apps/site", "script/mcpb-tooling", "services/mcp"];
const NPMRC_BYTES = "ignore-scripts=true\n";
const DISPOSITION = "disabled-by-default-no-exception";
const SEVERITIES = ["info", "low", "moderate", "high", "critical", "total"];
const PRUNED_DISCOVERY_DIRECTORIES = new Set([".git", "node_modules"]);
const GENERATED_OPERATIONAL_DIRECTORIES = new Set([".build", ".next", ".vinext", ".wrangler", "coverage", "dist"]);
const LIFECYCLE_CAPABLE_NPM_OPERATIONS = new Set([
  "add", "ci", "clean-install", "dedupe", "i", "ic", "in", "ins", "inst",
  "install", "install-clean", "link", "pack", "prune", "publish", "r", "rb",
  "rebuild", "remove", "rm", "un", "uninstall", "unlink", "up", "update", "upgrade",
]);
const NON_INSTALL_NPM_OPERATIONS = new Set([
  "access", "audit", "bugs", "cache", "completion", "config", "deprecate", "diff",
  "dist-tag", "docs", "doctor", "edit", "exec", "explain", "explore", "find-dupes",
  "fund", "help", "hook", "init", "ll", "login", "logout", "ls", "org", "outdated",
  "owner", "ping", "pkg", "prefix", "profile", "query", "repo",
  "restart", "root", "run", "run-script", "sbom", "search", "set", "shrinkwrap",
  "star", "stars", "start", "stop", "team", "test", "token", "unpublish", "unstar",
  "version", "view", "whoami",
]);
const NPM_OPTIONS_WITH_VALUES = new Set([
  "--cache", "--location", "--loglevel", "--prefix", "--registry", "--scope",
  "--userconfig", "--workspace", "-C", "-w",
]);
const PROHIBITED_ROOT_LIFECYCLE_SCRIPTS = new Set([
  "dependencies", "install", "postinstall", "postpack", "postpublish", "preinstall",
  "prepack", "prepare", "prepublish", "prepublishOnly", "publish",
]);

function readText(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJSON(path) {
  return JSON.parse(readText(path));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
}

function discoverRepositoryEntries(
  directory = ROOT,
  rootDirectory = directory,
  found = { files: [], symlinks: [] },
  generated = false,
) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (PRUNED_DISCOVERY_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    const repositoryPath = relative(rootDirectory, absolutePath).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      if (!generated || isPackageLockPath(repositoryPath) || isNpmShrinkwrapPath(repositoryPath) || isNpmrcPath(repositoryPath)) {
        found.symlinks.push(repositoryPath);
      }
      continue;
    }
    if (entry.isDirectory()) {
      discoverRepositoryEntries(
        absolutePath,
        rootDirectory,
        found,
        generated || GENERATED_OPERATIONAL_DIRECTORIES.has(entry.name),
      );
      continue;
    }
    if (entry.isFile()) found.files.push(repositoryPath);
  }
  return found;
}

function discoverTrackedRepositoryEntries() {
  const output = execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const found = { files: [], symlinks: [] };
  for (const record of output.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    assert.ok(tab > 0, "git tracked-file discovery emitted an invalid record");
    const metadata = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    assert.equal(metadata.length, 3, `git tracked-file metadata is invalid for ${path}`);
    const mode = metadata[0];
    try {
      lstatSync(join(ROOT, path));
    } catch {
      if (mode === "160000") found.symlinks.push(path);
      continue;
    }
    if (mode === "100644" || mode === "100755") found.files.push(path);
    else found.symlinks.push(path);
  }
  return found;
}

function discoverGovernedRepositoryEntries() {
  const filesystem = discoverRepositoryEntries();
  const tracked = discoverTrackedRepositoryEntries();
  return {
    files: [...new Set([...filesystem.files, ...tracked.files])],
    symlinks: [...new Set([...filesystem.symlinks, ...tracked.symlinks])],
  };
}

function isPackageLockPath(path) {
  return path === "package-lock.json" || path.endsWith("/package-lock.json");
}

function isNpmShrinkwrapPath(path) {
  return path === "npm-shrinkwrap.json" || path.endsWith("/npm-shrinkwrap.json");
}

function isNpmrcPath(path) {
  return path === ".npmrc" || path.endsWith("/.npmrc");
}

function isControlledInstallFile(path) {
  if (path.split("/").some((part) => GENERATED_OPERATIONAL_DIRECTORIES.has(part))) return false;
  return (path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path)) ||
    path.endsWith(".sh") ||
    path === "package.json" ||
    path.endsWith("/package.json") ||
    path.endsWith("/Dockerfile") ||
    path === "Dockerfile" ||
    path === "CLAUDE.md" ||
    path === "README.md" ||
    path === "CONTRIBUTING.md" ||
    path === "apps/site/README.md" ||
    path === "services/mcp/README.md";
}

function isControlledTransientExecutionFile(path) {
  if (path === "script/validate_npm_supply_chain.mjs") return false;
  return isControlledInstallFile(path) ||
    ((path.startsWith("script/") || path.includes("/scripts/")) && /\.(?:[cm]?js|ts)$/.test(path));
}

function isControlledOperationalFile(path) {
  return isControlledInstallFile(path) || isControlledTransientExecutionFile(path);
}

function validateDiscoveredSupplyChainFiles(lockfiles, shrinkwraps, npmrcs, symlinks, errors, rootDirectory = ROOT) {
  const expectedLockfiles = EXPECTED_WORKSPACES.map((workspace) => `${workspace}/package-lock.json`);
  const expectedNpmrcs = EXPECTED_WORKSPACES.map((workspace) => `${workspace}/.npmrc`);
  if (JSON.stringify(lockfiles) !== JSON.stringify(expectedLockfiles)) {
    errors.push("repository package-lock.json discovery must match the three governed workspaces exactly");
  }
  if (JSON.stringify(npmrcs) !== JSON.stringify(expectedNpmrcs)) {
    errors.push("repository .npmrc discovery must match the three governed workspaces exactly");
  }
  if (shrinkwraps.length !== 0) {
    errors.push("npm-shrinkwrap.json is unsupported because it would override a governed package-lock.json");
  }
  for (const path of symlinks) {
    let directoryTarget = false;
    try {
      directoryTarget = statSync(join(rootDirectory, path)).isDirectory();
    } catch {
      // A dangling or unreadable link cannot prove that supply-chain inputs are absent.
      directoryTarget = true;
    }
    if (isPackageLockPath(path) || isNpmShrinkwrapPath(path) || isNpmrcPath(path) || isControlledOperationalFile(path) || directoryTarget) {
      errors.push(`repository supply-chain discovery rejects symbolic link ${path}`);
    }
  }
}

function installCommandIsDenied(line) {
  const shellSegments = line.split(/&&|\|\||[;|]/);
  for (const segment of shellSegments) {
    const npmCommands = segment.matchAll(/(?:^|[\s:`>"'()/])npm\s+([^#]*)/g);
    for (const match of npmCommands) {
      const tokens = match[1].trim().split(/\s+/).filter(Boolean);
      let operation = null;
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.startsWith("-")) {
          if (NPM_OPTIONS_WITH_VALUES.has(token)) index += 1;
          continue;
        }
        operation = token;
        break;
      }
      if (NON_INSTALL_NPM_OPERATIONS.has(operation)) continue;
      const lifecycleOperation = LIFECYCLE_CAPABLE_NPM_OPERATIONS.has(operation) ||
        tokens.some((token) => LIFECYCLE_CAPABLE_NPM_OPERATIONS.has(token));
      if (!lifecycleOperation) continue;
      const ignoreScriptFlags = tokens.filter((token) => token.startsWith("--ignore-scripts"));
      if (ignoreScriptFlags.length !== 1) return false;
      if (!["--ignore-scripts", "--ignore-scripts=true"].includes(ignoreScriptFlags[0])) return false;
    }
  }
  return true;
}

function auditReportingIsSuppressed(line) {
  return /\b(?:npm_config_audit|NPM_CONFIG_AUDIT)\s*=\s*["']?(?:false|0|no)["']?(?:\s|$)/i.test(line) ||
    /(?:^|\s)(?:--no-audit|--audit=["']?(?:false|0|no)["']?)(?:\s|$)/i.test(line) ||
    /(?:^|\s)npm\s+config\s+set\s+audit(?:\s+|=)["']?(?:false|0|no)["']?(?:\s|$)/i.test(line);
}

function transientNpxIsUsed(line) {
  return /(?:^|[\s:`>"'()/])npx\b/.test(line);
}

function validateWorkspaceRootScripts(packageJSON, at, errors) {
  if (packageJSON.scripts === undefined) return;
  if (!isObject(packageJSON.scripts)) {
    errors.push(`${at}.scripts must be an object when present`);
    return;
  }
  for (const name of Object.keys(packageJSON.scripts)) {
    if (PROHIBITED_ROOT_LIFECYCLE_SCRIPTS.has(name)) {
      errors.push(`${at}.scripts.${name} is prohibited by the no-lifecycle execution policy`);
    }
  }
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

function sortIdentityRows(rows) {
  return [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function validateLiveAuditResult(policy, workspacePath, input) {
  assert.ok(EXPECTED_WORKSPACES.includes(workspacePath), "live audit workspace is not governed");
  assert.ok(Buffer.byteLength(input, "utf8") > 0, "live npm audit output is empty");
  assert.ok(Buffer.byteLength(input, "utf8") <= 8 * 1024 * 1024, "live npm audit output exceeds 8 MiB");
  const report = JSON.parse(input);
  assert.equal(report.auditReportVersion, 2, "live npm audit report version must equal 2");
  assert.ok(isObject(report.vulnerabilities), "live npm audit vulnerabilities must be an object");
  assert.ok(isObject(report.metadata), "live npm audit metadata must be an object");
  assert.ok(isObject(report.metadata.vulnerabilities), "live npm audit counts must be an object");
  assert.deepEqual(Object.keys(report.metadata.vulnerabilities).sort(), [...SEVERITIES].sort(), "live npm audit count keys drifted");
  for (const severity of SEVERITIES) {
    assert.ok(Number.isInteger(report.metadata.vulnerabilities[severity]) && report.metadata.vulnerabilities[severity] >= 0, `live npm audit ${severity} count is invalid`);
  }
  const expectedWorkspace = policy.auditPolicy.workspaces.find((workspace) => workspace.path === workspacePath);
  assert.ok(expectedWorkspace, "live npm audit workspace has no policy row");
  assert.deepEqual(report.metadata.vulnerabilities, expectedWorkspace.counts, `live npm audit counts drifted for ${workspacePath}`);
  assert.equal(Object.keys(report.vulnerabilities).length, report.metadata.vulnerabilities.total, "live npm audit vulnerability rows do not match total");
  assert.equal(report.metadata.vulnerabilities.moderate, 0, "live npm audit retains a moderate advisory");
  assert.equal(report.metadata.vulnerabilities.high, 0, "live npm audit retains a high advisory");
  assert.equal(report.metadata.vulnerabilities.critical, 0, "live npm audit retains a critical advisory");

  const actualResiduals = [];
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    assert.ok(isObject(vulnerability), `live npm audit vulnerability ${packageName} must be an object`);
    assert.equal(vulnerability.name, packageName, `live npm audit vulnerability ${packageName} changed its package name`);
    assert.equal(vulnerability.severity, "low", `live npm audit vulnerability ${packageName} is not low`);
    assert.ok(Array.isArray(vulnerability.nodes) && vulnerability.nodes.length > 0, `live npm audit vulnerability ${packageName} has no node path`);
    assert.ok(Array.isArray(vulnerability.via), `live npm audit vulnerability ${packageName} has no advisory path`);
    const advisoryRows = vulnerability.via.filter(isObject);
    assert.ok(advisoryRows.length > 0, `live npm audit vulnerability ${packageName} has no direct advisory identity`);
    for (const advisory of advisoryRows) {
      const identifier = typeof advisory.url === "string"
        ? advisory.url.match(/(?:^|\/)(GHSA-[a-z0-9-]+)(?:$|[?#])/)?.[1]
        : null;
      assert.match(identifier ?? "", /^GHSA-[a-z0-9-]+$/, `live npm audit vulnerability ${packageName} has no canonical GHSA identity`);
      assert.equal(advisory.name, packageName, `live npm audit advisory ${identifier} changed package identity`);
      assert.equal(advisory.severity, "low", `live npm audit advisory ${identifier} is not low`);
      for (const nodePath of vulnerability.nodes) {
        assert.equal(typeof nodePath, "string", `live npm audit advisory ${identifier} has an invalid node path`);
        actualResiduals.push({
          advisory: identifier,
          package: packageName,
          nodePath,
          severity: "low",
          workspace: workspacePath,
        });
      }
    }
  }
  const expectedResiduals = policy.auditPolicy.residualFindings
    .filter((finding) => finding.workspace === workspacePath)
    .map(({ advisory, package: packageName, nodePath, severity, workspace }) => ({
      advisory,
      package: packageName,
      nodePath,
      severity,
      workspace,
    }));
  assert.deepEqual(
    sortIdentityRows(actualResiduals),
    sortIdentityRows(expectedResiduals),
    `live npm audit residual identities drifted for ${workspacePath}`,
  );
}

function makeLiveAuditFixture(policy, workspacePath) {
  const workspace = policy.auditPolicy.workspaces.find((row) => row.path === workspacePath);
  const residuals = policy.auditPolicy.residualFindings.filter((finding) => finding.workspace === workspacePath);
  const vulnerabilities = Object.fromEntries(residuals.map((finding) => [finding.package, {
    name: finding.package,
    severity: finding.severity,
    isDirect: false,
    via: [{
      source: 1,
      name: finding.package,
      dependency: finding.package,
      title: "synthetic validator fixture",
      url: `https://github.com/advisories/${finding.advisory}`,
      severity: finding.severity,
      cwe: [],
      cvss: { score: 0, vectorString: null },
      range: "*",
    }],
    effects: [],
    range: "*",
    nodes: [finding.nodePath],
    fixAvailable: true,
  }]));
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: structuredClone(workspace.counts),
      dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 },
    },
  };
}

function validateNpmPackLifecycleDenial() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ambient-npm-pack-denial-"));
  const outputDirectory = join(fixtureRoot, "packed");
  try {
    mkdirSync(outputDirectory);
    writeFileSync(join(fixtureRoot, "hook.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "ran\\n");\n');
    writeFileSync(join(fixtureRoot, "package.json"), `${JSON.stringify({
      name: "ambient-npm-pack-denial-fixture",
      version: "1.0.0",
      scripts: {
        prepack: "node hook.mjs prepack-marker",
        prepare: "node hook.mjs prepare-marker",
        postpack: "node hook.mjs postpack-marker",
      },
    }, null, 2)}\n`);
    execFileSync("npm", [
      "pack", fixtureRoot,
      "--pack-destination", outputDirectory,
      "--ignore-scripts",
      "--json",
    ], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        npm_config_cache: join(fixtureRoot, "npm-cache"),
        npm_config_userconfig: "/dev/null",
      },
      stdio: "pipe",
    });
    for (const marker of ["prepack-marker", "prepare-marker", "postpack-marker"]) {
      assert.equal(existsSync(join(fixtureRoot, marker)), false, `npm pack executed prohibited ${marker}`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
  const repositoryEntries = discoverGovernedRepositoryEntries();
  const repositoryFiles = repositoryEntries.files.sort();
  const repositorySymlinks = repositoryEntries.symlinks.sort();
  const discoveredLockfiles = repositoryFiles.filter(isPackageLockPath);
  const discoveredShrinkwraps = repositoryFiles.filter(isNpmShrinkwrapPath);
  const discoveredNpmrcs = repositoryFiles.filter(isNpmrcPath);
  validateDiscoveredSupplyChainFiles(
    discoveredLockfiles,
    discoveredShrinkwraps,
    discoveredNpmrcs,
    repositorySymlinks,
    errors,
  );
  for (const workspace of policy.installPolicy.workspaces) {
    const lockPath = `${workspace.path}/package-lock.json`;
    const packagePath = `${workspace.path}/package.json`;
    const npmrcPath = `${workspace.path}/.npmrc`;
    if (sha256(lockPath) !== workspace.lockfileSHA256) errors.push(`${lockPath} digest does not match policy`);
    if (readText(npmrcPath) !== NPMRC_BYTES) errors.push(`${npmrcPath} must contain only the exact deny policy`);
    const lock = readJSON(lockPath);
    const packageJSON = readJSON(packagePath);
    validateWorkspaceRootScripts(packageJSON, packagePath, errors);
    if (lock.lockfileVersion !== 3) errors.push(`${lockPath} must use lockfileVersion 3`);
    const rootPackage = lock.packages?.[""];
    if (!rootPackage || rootPackage.name !== packageJSON.name || rootPackage.version !== packageJSON.version) errors.push(`${lockPath} root package does not match package.json`);
    const actualInventory = lockInstallScriptInventory(lock);
    if (JSON.stringify(actualInventory) !== JSON.stringify(workspace.installScriptPackages)) errors.push(`${lockPath} install-script inventory drifted`);
  }

  const controlledInstallFiles = repositoryFiles.filter(isControlledInstallFile);
  for (const path of controlledInstallFiles) {
    for (const [index, line] of readText(path).split("\n").entries()) {
      if (!installCommandIsDenied(line)) errors.push(`${path}:${index + 1} npm install command must explicitly disable lifecycle scripts`);
      if (auditReportingIsSuppressed(line)) errors.push(`${path}:${index + 1} npm advisory reporting must not be suppressed`);
    }
  }
  for (const path of repositoryFiles.filter(isControlledTransientExecutionFile)) {
    for (const [index, line] of readText(path).split("\n").entries()) {
      if (transientNpxIsUsed(line)) errors.push(`${path}:${index + 1} transient npx execution is prohibited; use committed locked tooling`);
    }
  }
  const aggregate = readText("script/verify_release.sh");
  if (!aggregate.includes("validate_npm_supply_chain.mjs")) errors.push("script/verify_release.sh must invoke the npm supply-chain validator");
  const workflow = readText(".github/workflows/release-integrity.yml");
  if (!workflow.includes("node script/validate_npm_supply_chain.mjs")) errors.push("release-integrity.yml must invoke the npm supply-chain validator");
  for (const [path, content] of [
    ["script/verify_release.sh", aggregate],
    [".github/workflows/release-integrity.yml", workflow],
  ]) {
    if (!content.includes("audit --package-lock-only --audit-level=moderate --json")) errors.push(`${path} must collect live npm audit JSON`);
    if (!content.includes("--validate-audit-result")) errors.push(`${path} must reconcile live npm audit identities`);
  }
  for (const trigger of [
    ".github/workflows/**",
    "package-lock.json",
    "**/package-lock.json",
    "npm-shrinkwrap.json",
    "**/npm-shrinkwrap.json",
    ".npmrc",
    "**/.npmrc",
    "**/*.sh",
    "package.json",
    "**/package.json",
    "**/*.mjs",
    "Dockerfile",
    "**/Dockerfile",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "docs/security/**",
  ]) {
    if (!workflow.includes(`- "${trigger}"`)) errors.push(`release-integrity.yml must trigger on ${trigger}`);
  }
  const mcpPackage = readJSON("services/mcp/package.json");
  if (mcpPackage.scripts?.["pack:mcpb"] !== "../../script/build_mcpb_release.sh ./project-ambient-control.mcpb") {
    errors.push("services/mcp pack:mcpb must use the committed locked MCPB builder");
  }
  if (repositoryFiles.includes("services/mcp/scripts/pack-mcpb.mjs")) {
    errors.push("the retired transient MCPB packer must not return");
  }
  return errors;
}

function withDiscoveryFixture(setup, verify) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ambient-npm-policy-discovery-"));
  try {
    for (const workspace of EXPECTED_WORKSPACES) {
      mkdirSync(join(fixtureRoot, workspace), { recursive: true });
      writeFileSync(join(fixtureRoot, workspace, "package-lock.json"), "{}\n");
      writeFileSync(join(fixtureRoot, workspace, ".npmrc"), NPMRC_BYTES);
    }
    setup(fixtureRoot);
    const entries = discoverRepositoryEntries(fixtureRoot);
    verify(entries, fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
const arguments_ = process.argv.slice(2);
if (arguments_.length > 0) {
  assert.deepEqual(arguments_.slice(0, 1), ["--validate-audit-result"], "usage: validate_npm_supply_chain.mjs [--validate-audit-result workspace]");
  assert.equal(arguments_.length, 2, "usage: validate_npm_supply_chain.mjs [--validate-audit-result workspace]");
  validateLiveAuditResult(policy, arguments_[1], readFileSync(0, "utf8"));
  console.log(`OK: live npm audit exactly matches the governed counts and residual identities for ${arguments_[1]}`);
  process.exit(0);
}
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
withDiscoveryFixture(
  () => {},
  (entries, fixtureRoot) => {
    const errors = [];
    validateDiscoveredSupplyChainFiles(
      entries.files.filter(isPackageLockPath).sort(),
      entries.files.filter(isNpmShrinkwrapPath).sort(),
      entries.files.filter(isNpmrcPath).sort(),
      entries.symlinks.sort(),
      errors,
      fixtureRoot,
    );
    assert.deepEqual(errors, [], "baseline supply-chain discovery fixture");
  },
);
withDiscoveryFixture(
  (fixtureRoot) => writeFileSync(join(fixtureRoot, "package-lock.json"), "{}\n"),
  (entries, fixtureRoot) => {
    const errors = [];
    validateDiscoveredSupplyChainFiles(
      entries.files.filter(isPackageLockPath).sort(),
      entries.files.filter(isNpmShrinkwrapPath).sort(),
      entries.files.filter(isNpmrcPath).sort(),
      entries.symlinks.sort(),
      errors,
      fixtureRoot,
    );
    assert.ok(errors.some((error) => error.includes("package-lock.json discovery")), "repository-root lockfile discovery");
  },
);
tamperCases.push("repository-root lockfile discovery");
withDiscoveryFixture(
  (fixtureRoot) => {
    mkdirSync(join(fixtureRoot, "review-fixtures/dist"), { recursive: true });
    writeFileSync(join(fixtureRoot, "review-fixtures/dist/package-lock.json"), "{}\n");
  },
  (entries, fixtureRoot) => {
    const errors = [];
    validateDiscoveredSupplyChainFiles(
      entries.files.filter(isPackageLockPath).sort(),
      entries.files.filter(isNpmShrinkwrapPath).sort(),
      entries.files.filter(isNpmrcPath).sort(),
      entries.symlinks.sort(),
      errors,
      fixtureRoot,
    );
    assert.ok(errors.some((error) => error.includes("package-lock.json discovery")), "generated-name lockfile discovery");
  },
);
tamperCases.push("generated-name lockfile discovery");
withDiscoveryFixture(
  (fixtureRoot) => writeFileSync(join(fixtureRoot, "services/mcp/npm-shrinkwrap.json"), "{}\n"),
  (entries, fixtureRoot) => {
    const errors = [];
    validateDiscoveredSupplyChainFiles(
      entries.files.filter(isPackageLockPath).sort(),
      entries.files.filter(isNpmShrinkwrapPath).sort(),
      entries.files.filter(isNpmrcPath).sort(),
      entries.symlinks.sort(),
      errors,
      fixtureRoot,
    );
    assert.ok(errors.some((error) => error.includes("npm-shrinkwrap.json is unsupported")), "npm shrinkwrap discovery");
  },
);
tamperCases.push("npm shrinkwrap discovery");
withDiscoveryFixture(
  (fixtureRoot) => {
    writeFileSync(join(fixtureRoot, "unreviewed-lock.json"), "{}\n");
    mkdirSync(join(fixtureRoot, "unreviewed"), { recursive: true });
    symlinkSync("../unreviewed-lock.json", join(fixtureRoot, "unreviewed/package-lock.json"));
  },
  (entries, fixtureRoot) => {
    const errors = [];
    validateDiscoveredSupplyChainFiles(
      entries.files.filter(isPackageLockPath).sort(),
      entries.files.filter(isNpmShrinkwrapPath).sort(),
      entries.files.filter(isNpmrcPath).sort(),
      entries.symlinks.sort(),
      errors,
      fixtureRoot,
    );
    assert.ok(errors.some((error) => error.includes("symbolic link unreviewed/package-lock.json")), "symbolic-link lockfile discovery");
  },
);
tamperCases.push("symbolic-link lockfile discovery");
withDiscoveryFixture(
  (fixtureRoot) => writeFileSync(join(fixtureRoot, ".npmrc"), NPMRC_BYTES),
  (entries, fixtureRoot) => {
    const errors = [];
    validateDiscoveredSupplyChainFiles(
      entries.files.filter(isPackageLockPath).sort(),
      entries.files.filter(isNpmShrinkwrapPath).sort(),
      entries.files.filter(isNpmrcPath).sort(),
      entries.symlinks.sort(),
      errors,
      fixtureRoot,
    );
    assert.ok(errors.some((error) => error.includes(".npmrc discovery")), "repository-root npmrc discovery");
  },
);
tamperCases.push("repository-root npmrc discovery");
for (const unsafeCommand of [
  "npm ci",
  "RUN npm ci",
  "- run: npm ci",
  "cd services/mcp && npm ci",
  "npm ci --ignore-scripts=false",
  "/usr/bin/npm ci",
  "npm i",
  "npm rebuild",
  "npm pack .",
  "npm publish",
  "npm ci \\",
  "npm ci $NPM_FLAGS",
  "npm ci --no-ignore-scripts",
  "npm ci --ignore-scripts --ignore-scripts=false",
]) {
  assert.equal(installCommandIsDenied(unsafeCommand), false, `unguarded install command: ${unsafeCommand}`);
  tamperCases.push(`unguarded install command: ${unsafeCommand}`);
}
for (const safeCommand of [
  "npm ci --ignore-scripts",
  "RUN npm ci --ignore-scripts=true",
  "cd services/mcp && npm ci --ignore-scripts && npm test",
  "npm --prefix services/mcp ci --ignore-scripts",
  "npm run ci",
  "npm pack . --ignore-scripts",
]) {
  assert.equal(installCommandIsDenied(safeCommand), true, `guarded install command: ${safeCommand}`);
}
const lifecycleScriptErrors = [];
validateWorkspaceRootScripts({ scripts: { prepack: "node prepack.js" } }, "fixture/package.json", lifecycleScriptErrors);
assert.ok(lifecycleScriptErrors.some((error) => error.includes("scripts.prepack")), "root prepack hook tamper");
tamperCases.push("root prepack hook tamper");
assert.equal(transientNpxIsUsed('await run("npx", ["--yes", "package"])'), true, "transient npx execution");
tamperCases.push("transient npx execution");
for (const suppressedAudit of [
  "export npm_config_audit=false",
  "export npm_config_audit='false'",
  "NPM_CONFIG_AUDIT=0 npm ci --ignore-scripts",
  "npm ci --ignore-scripts --no-audit",
  "npm ci --ignore-scripts --audit=\"false\"",
  "npm config set audit false",
  "npm config set audit=false",
]) {
  assert.equal(auditReportingIsSuppressed(suppressedAudit), true, `suppressed npm audit: ${suppressedAudit}`);
  tamperCases.push(`suppressed npm audit: ${suppressedAudit}`);
}
for (const workspace of EXPECTED_WORKSPACES) {
  validateLiveAuditResult(policy, workspace, JSON.stringify(makeLiveAuditFixture(policy, workspace)));
}
validateNpmPackLifecycleDenial();
for (const [label, mutate] of [
  ["fabricated residual advisory identity", (value) => { value.auditPolicy.residualFindings[0].advisory = "GHSA-aaaa-bbbb-cccc"; }],
  ["duplicate residual advisory identity", (value) => { value.auditPolicy.residualFindings.push(structuredClone(value.auditPolicy.residualFindings[0])); }],
  ["wrong-workspace residual advisory identity", (value) => { value.auditPolicy.residualFindings[0].workspace = "services/mcp"; }],
  ["missing residual advisory identity", (value) => { value.auditPolicy.residualFindings = []; }],
]) {
  const candidate = structuredClone(policy);
  mutate(candidate);
  assert.throws(
    () => validateLiveAuditResult(candidate, "apps/site", JSON.stringify(makeLiveAuditFixture(policy, "apps/site"))),
    /live npm audit residual identities drifted/,
    label,
  );
  tamperCases.push(label);
}

const shapeErrors = validatePolicyShape(policy);
assert.deepEqual(shapeErrors, [], `invalid npm supply-chain policy:\n${shapeErrors.join("\n")}`);
const repositoryErrors = validateRepository(policy);
assert.deepEqual(repositoryErrors, [], `npm supply-chain repository drift:\n${repositoryErrors.join("\n")}`);

const disabledCount = policy.installPolicy.workspaces.reduce((sum, workspace) => sum + workspace.installScriptPackages.length, 0);
const residualCount = policy.auditPolicy.residualFindings.length;
console.log(`OK: ${POLICY_PATH} covers ${EXPECTED_WORKSPACES.length} locked workspaces and disables ${disabledCount} install-script packages with no exceptions`);
console.log(`OK: captured audits retain 0 moderate/high/critical findings and ${residualCount} tracked low finding`);
console.log(`self-test: all ${tamperCases.length} tamper cases rejected; validation is fail-closed`);
