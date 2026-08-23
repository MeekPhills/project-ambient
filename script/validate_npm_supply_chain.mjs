#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
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
const EXPECTED_PACKAGE_RELEASE_SHA256 = "18dac0bbdca8cb25c79d0976e6aa5138dcffc56beae206ad56936c1c0f432f01";
const EXPECTED_BUILD_MCPB_RELEASE_SHA256 = "1480d949e767333fbf02dd3e92988580ebbeb6fa9332b23d2ab0fb5ddb168be9";
const EXPECTED_VERIFY_RELEASE_SHA256 = "455ae08cb53d678bc8599642e590905c2ce4f315fa11f3c756c75cacb839dc9e";
const EXPECTED_RELEASE_INTEGRITY_SHA256 = "c9f91518059e1e544fe52e1550e3d938822a3faf82d1f46c153c5a9bcda60cbf";
const EXPECTED_WORKSPACES = ["apps/site", "script/mcpb-tooling", "services/mcp"];
const NPMRC_BYTES = "ignore-scripts=true\n";
const GITATTRIBUTES_BYTES = "*.json text eol=lf\n*.sh text eol=lf\n*.yaml text eol=lf\n*.yml text eol=lf\n.npmrc text eol=lf\n";
const DISPOSITION = "disabled-by-default-no-exception";
const SEVERITIES = ["info", "low", "moderate", "high", "critical", "total"];
const PRUNED_DISCOVERY_DIRECTORIES = new Set([".git", "node_modules"]);
const GENERATED_OPERATIONAL_DIRECTORIES = new Set([".build", ".next", ".vinext", ".wrangler", "coverage", "dist"]);
const LIFECYCLE_CAPABLE_NPM_OPERATIONS = new Set([
  "add", "ci", "cit", "clean-install", "clean-install-test", "dedupe", "ddp", "i",
  "ic", "in", "ins", "inst", "insta", "instal", "install", "install-ci-test",
  "install-clean", "install-test", "isnt", "isnta", "isntal", "isntall",
  "isntall-clean", "it", "link", "ln", "pack", "prune", "publish", "r", "rb",
  "rebuild", "remove", "rm", "sit", "u", "un", "uninstall", "unlink", "up",
  "update", "upgrade", "udpate",
]);
const PROHIBITED_TRANSIENT_NPM_OPERATIONS = new Set(["exec", "x"]);
const NON_INSTALL_NPM_OPERATIONS = new Set([
  "access", "audit", "bugs", "cache", "completion", "config", "deprecate", "diff",
  "dist-tag", "docs", "doctor", "edit", "explain", "explore", "find-dupes",
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
  "dependencies", "install", "postdependencies", "postinstall", "postpack",
  "postprepare", "postpublish", "predependencies", "preinstall", "prepack",
  "prepare", "preprepare", "prepublish", "prepublishOnly", "publish",
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
  const folded = path.toLowerCase();
  return folded === "package-lock.json" || folded.endsWith("/package-lock.json");
}

function isNpmShrinkwrapPath(path) {
  const folded = path.toLowerCase();
  return folded === "npm-shrinkwrap.json" || folded.endsWith("/npm-shrinkwrap.json");
}

function isNpmrcPath(path) {
  const folded = path.toLowerCase();
  return folded === ".npmrc" || folded.endsWith("/.npmrc");
}

function isControlledInstallFile(path) {
  if (path.split("/").some((part) => GENERATED_OPERATIONAL_DIRECTORIES.has(part))) return false;
  return (path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path)) ||
    (path.startsWith(".github/actions/") && /(?:^|\/)action\.ya?ml$/.test(path)) ||
    /\.(?:sh|bash|zsh)$/.test(path) ||
    path === "package.json" ||
    path.endsWith("/package.json") ||
    path.endsWith("/Dockerfile") ||
    path === "Dockerfile" ||
    path === "CLAUDE.md" ||
    path === "README.md" ||
    path === "CONTRIBUTING.md" ||
    path === "docs/reports/m0-issue-17-repository-baseline.md" ||
    path === "apps/site/README.md" ||
    path === "services/mcp/README.md";
}

function normalizeNpmOperation(operation) {
  if (typeof operation !== "string") return operation;
  return operation
    .replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`)
    .toLowerCase();
}

function npmOperationMayRunLifecycle(operation) {
  const normalized = normalizeNpmOperation(operation);
  if (typeof normalized !== "string" || normalized.length === 0) return false;
  if (LIFECYCLE_CAPABLE_NPM_OPERATIONS.has(normalized)) return true;
  if (NON_INSTALL_NPM_OPERATIONS.has(normalized)) return false;
  if (normalized.length < 3) return false;
  return [...LIFECYCLE_CAPABLE_NPM_OPERATIONS].some((candidate) => candidate.startsWith(normalized));
}

function scriptControlFlag(token) {
  const match = token.match(/^(-{1,2})([^=]+)(?:=(.*))?$/);
  if (!match) return null;
  const name = match[2].replaceAll("_", "-").toLowerCase();
  const scriptControlName = ["ignore-scripts", "no-ignore-scripts"].find(
    (candidate) => name.length >= 3 && candidate.startsWith(name),
  );
  if (!scriptControlName) return null;
  return {
    exactAllowed: match[1] === "--" && name === "ignore-scripts" &&
      (match[3] === undefined || match[3] === "true"),
    hasSeparateValue: match[3] === undefined,
  };
}

function normalizeShellNpmExecutables(segment) {
  return segment
    .replace(/\$?(["'])(?:[^"'\r\n]*\/)?npm\1(?=\s)/g, "npm")
    .replace(/\\?n\\?p\\?m(?=\s)/g, "npm");
}

function isControlledTransientExecutionFile(path) {
  if (path === "script/validate_npm_supply_chain.mjs") return false;
  if (path.split("/").some((part) => GENERATED_OPERATIONAL_DIRECTORIES.has(part))) return false;
  return /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(path);
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
  for (const rawSegment of shellSegments) {
    const segment = normalizeShellNpmExecutables(rawSegment);
    const npmCommands = segment.matchAll(/(?=(?:^|[\s:`>"'()/])npm\s+([^#]*))/g);
    for (const match of npmCommands) {
      const tokens = match[1].trim().split(/\s+/).filter(Boolean)
        .map((token) => token.replace(/^["'(`]+|["'),`]+$/g, ""));
      const scriptControlIndices = tokens.flatMap((token, index) => scriptControlFlag(token) ? [index] : []);
      const scriptControlFlags = scriptControlIndices.map((index) => scriptControlFlag(tokens[index]));
      if (scriptControlFlags.some((flag) => !flag.exactAllowed)) return false;
      if (scriptControlFlags.some((flag, index) =>
        flag.hasSeparateValue &&
        /^(?:true|false|0|1|yes|no|on|off)$/i.test(tokens[scriptControlIndices[index] + 1] ?? "")
      )) return false;
      let operation = null;
      let ambiguousPreOperationOption = false;
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.startsWith("-")) {
          if (scriptControlFlag(token)) continue;
          if (NPM_OPTIONS_WITH_VALUES.has(token)) index += 1;
          else ambiguousPreOperationOption = true;
          continue;
        }
        operation = token;
        break;
      }
      if (typeof operation === "string" && operation.includes("$")) return false;
      operation = normalizeNpmOperation(operation);
      if (PROHIBITED_TRANSIENT_NPM_OPERATIONS.has(operation)) return false;
      if (ambiguousPreOperationOption && scriptControlFlags.length !== 1) return false;
      if (!npmOperationMayRunLifecycle(operation)) continue;
      if (scriptControlFlags.length !== 1) return false;
    }
  }
  return true;
}

function logicalCommandLines(input) {
  const result = [];
  let current = "";
  let startLine = 1;
  for (const [index, physicalLine] of input.split("\n").entries()) {
    if (current.length === 0) startLine = index + 1;
    const continued = /\\\s*$/.test(physicalLine);
    const fragment = continued ? physicalLine.replace(/\\\s*$/, " ") : physicalLine;
    current += fragment;
    if (!continued) {
      result.push({ line: startLine, text: current });
      current = "";
    }
  }
  if (current.length > 0) result.push({ line: startLine, text: current });
  return result;
}

function yamlFoldedRunCommandLines(input) {
  const lines = input.split("\n");
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^(\s*)(?:-\s*)?run:\s*>[-+0-9]*\s*(?:#.*)?$/);
    if (!header) continue;
    const headerIndent = header[1].length;
    const fragments = [];
    let child = index + 1;
    for (; child < lines.length; child += 1) {
      const physicalLine = lines[child];
      if (physicalLine.trim().length === 0) {
        fragments.push("");
        continue;
      }
      const childIndent = physicalLine.match(/^\s*/)[0].length;
      if (childIndent <= headerIndent) break;
      fragments.push(physicalLine.trim());
    }
    result.push({ line: index + 1, text: fragments.join(" ") });
    index = child - 1;
  }
  return result;
}

function operationalCommandLines(input) {
  return [...logicalCommandLines(input), ...yamlFoldedRunCommandLines(input)];
}

function auditReportingIsSuppressed(line) {
  return /\b(?:npm_config_audit|NPM_CONFIG_AUDIT)\s*=\s*["']?(?:false|0|no)["']?(?:\s|$)/i.test(line) ||
    /(?:^|\s)(?:--no-aud(?:it)?|--audit=["']?(?:false|0|no)["']?|--audit\s+["']?(?:false|0|no)["']?)(?:\s|$)/i.test(line) ||
    /(?:^|\s)npm\s+config\s+set\s+audit(?:\s+|=)["']?(?:false|0|no)["']?(?:\s|$)/i.test(line);
}

function transientNpxIsUsed(line) {
  return /(?:^|[\s:`>"'()/])npx\b/.test(line);
}

function indirectNpmLifecycleIsUsed(line) {
  const operations = [...LIFECYCLE_CAPABLE_NPM_OPERATIONS].sort((a, b) => b.length - a.length)
    .map((operation) => operation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const variableInvocation = new RegExp(`["']?\\$\\{?(?:NPM[A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*NPM[A-Za-z0-9_]*)\\}?["']?\\s+(?:${operations})(?:\\s|$)`, "i");
  const commandSubstitution = new RegExp(`\\$\\([^)]*\\bnpm\\b[^)]*\\)\\s+(?:${operations})(?:\\s|$)`, "i");
  const npmAssignment = /(?:^|[;\s])(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:\$\([^)]*\bnpm\b[^)]*\)|\(?["']?(?:[^"'\s;]*\/)?npm["']?\)?)(?:[;\s]|$)/i;
  const npmAlias = /(?:^|[;\s])alias\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']?npm(?:["']|[;\s]|$)/i;
  return variableInvocation.test(line) || commandSubstitution.test(line) || npmAssignment.test(line) || npmAlias.test(line);
}

function programmaticNpmExecutionIsUsed(source) {
  const processCall = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|execa|run)\s*\(\s*(?:["'`][^"'`\r\n]*npm["'`]|(?=[A-Za-z0-9_$.]*npm)[A-Za-z_$][A-Za-z0-9_$.]*)\s*(?:,|\))/i;
  if (processCall.test(source)) return true;
  const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*["'`](?:[^"'`\r\n]*\/)?npm["'`]/g;
  for (const match of source.matchAll(assignment)) {
    const variable = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const invocation = new RegExp(
      `\\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|execa|run)\\s*\\(\\s*${variable}\\s*(?:,|\\))`,
    );
    if (invocation.test(source)) return true;
  }
  return false;
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

function validateReleasePackagerBoundary(source, errors) {
  const expected = [
    'node "$ROOT_DIR/script/validate_npm_supply_chain.mjs"',
    'npm_config_cache="$STAGE_DIR/.npm-cache" \\',
    "npm_config_userconfig=/dev/null \\",
    'npm pack "$MCP_DIR" --pack-destination "$STAGE_DIR" --ignore-scripts >/dev/null',
  ];
  const lines = source.split("\n").map((line) => line.trim());
  const starts = lines.flatMap((line, index) => line === expected[0] ? [index] : []);
  if (starts.length !== 1 || JSON.stringify(lines.slice(starts[0], starts[0] + expected.length)) !== JSON.stringify(expected)) {
    errors.push("release packaging must run one exact active policy validator immediately before npm pack");
  }
  const packCommands = logicalCommandLines(source).filter((command) => /(?:^|\s)npm\s+pack\b/.test(command.text));
  if (packCommands.length !== 1) errors.push("release packaging must contain exactly one npm pack command");
  const sourceSHA256 = createHash("sha256").update(source).digest("hex");
  if (sourceSHA256 !== EXPECTED_PACKAGE_RELEASE_SHA256) {
    errors.push("script/package_release.sh changed outside the reviewed pre-pack boundary");
  }
}

function validateLiveAuditGateSources(aggregate, workflow, errors) {
  const aggregateSHA256 = createHash("sha256").update(aggregate).digest("hex");
  if (aggregateSHA256 !== EXPECTED_VERIFY_RELEASE_SHA256) {
    errors.push("script/verify_release.sh changed outside the reviewed live-audit gate");
  }
  const workflowSHA256 = createHash("sha256").update(workflow).digest("hex");
  if (workflowSHA256 !== EXPECTED_RELEASE_INTEGRITY_SHA256) {
    errors.push("release-integrity.yml changed outside the reviewed live-audit gate");
  }
}

function validateMcpbBuilderBoundary(source, errors) {
  if (createHash("sha256").update(source).digest("hex") !== EXPECTED_BUILD_MCPB_RELEASE_SHA256) {
    errors.push("script/build_mcpb_release.sh changed outside the reviewed credential-isolated packaging boundary");
  }
  for (const required of [
    "env -i \\",
    'npm_config_userconfig="$NPM_USER_CONFIG" \\',
    'npm_config_globalconfig="$NPM_GLOBAL_CONFIG" \\',
    "npm_config_registry=https://registry.npmjs.org/ \\",
  ]) {
    if (!source.includes(required)) errors.push(`MCPB builder must retain ${required}`);
  }
}

function validateLineEndingPolicy(source, errors) {
  if (source !== GITATTRIBUTES_BYTES) {
    errors.push(".gitattributes must pin every byte-governed JSON, shell, workflow, and npmrc file to LF");
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
      const residualIdentities = new Set();
      for (const [index, finding] of audit.residualFindings.entries()) {
        const at = `$.auditPolicy.residualFindings[${index}]`;
        if (!exactKeys(finding, ["advisory", "package", "nodePath", "severity", "workspace", "disposition", "reason"], at, errors)) continue;
        if (!/^GHSA-[a-z0-9-]+$/.test(finding.advisory ?? "")) errors.push(`${at}.advisory must be a GHSA identifier`);
        if (finding.severity !== "low") errors.push(`${at}.severity may retain only low findings`);
        if (!EXPECTED_WORKSPACES.includes(finding.workspace)) errors.push(`${at}.workspace is unknown`);
        if (typeof finding.nodePath !== "string" || !finding.nodePath.startsWith("node_modules/")) errors.push(`${at}.nodePath must be a dependency path`);
        if (finding.disposition !== "tracked-development-only-major-fix-deferred") errors.push(`${at}.disposition must remain explicit`);
        if (typeof finding.reason !== "string" || finding.reason.length < 80) errors.push(`${at}.reason must retain concrete evidence and tradeoff`);
        const identity = JSON.stringify([finding.workspace, finding.package, finding.advisory, finding.nodePath]);
        if (residualIdentities.has(identity)) errors.push(`${at} duplicates a residual advisory/node identity`);
        residualIdentities.add(identity);
      }
      for (const workspace of audit.workspaces ?? []) {
        const retainedPackages = new Set(
          audit.residualFindings
            .filter((finding) => finding.workspace === workspace.path)
            .map((finding) => finding.package),
        );
        if (retainedPackages.size !== workspace.counts?.low) {
          errors.push(`${workspace.path} residual identities must map every retained low package once or more`);
        }
      }
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
  const vulnerabilities = {};
  for (const finding of residuals) {
    const vulnerability = vulnerabilities[finding.package] ?? {
      name: finding.package,
      severity: finding.severity,
      isDirect: false,
      via: [],
      effects: [],
      range: "*",
      nodes: [],
      fixAvailable: true,
    };
    if (!vulnerability.via.some((advisory) => advisory.url.endsWith(finding.advisory))) {
      vulnerability.via.push({
        source: vulnerability.via.length + 1,
        name: finding.package,
        dependency: finding.package,
        title: "synthetic validator fixture",
        url: `https://github.com/advisories/${finding.advisory}`,
        severity: finding.severity,
        cwe: [],
        cvss: { score: 0, vectorString: null },
        range: "*",
      });
    }
    if (!vulnerability.nodes.includes(finding.nodePath)) vulnerability.nodes.push(finding.nodePath);
    vulnerabilities[finding.package] = vulnerability;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: structuredClone(workspace.counts),
      dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 },
    },
  };
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
  validateLineEndingPolicy(readText(".gitattributes"), errors);
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
    for (const command of operationalCommandLines(readText(path))) {
      if (!installCommandIsDenied(command.text)) errors.push(`${path}:${command.line} npm install command must explicitly disable lifecycle scripts`);
      if (indirectNpmLifecycleIsUsed(command.text)) errors.push(`${path}:${command.line} indirect npm lifecycle execution is prohibited`);
      if (auditReportingIsSuppressed(command.text)) errors.push(`${path}:${command.line} npm advisory reporting must not be suppressed`);
    }
  }
  for (const path of repositoryFiles.filter(isControlledTransientExecutionFile)) {
    const content = readText(path);
    for (const command of operationalCommandLines(content)) {
      if (transientNpxIsUsed(command.text)) errors.push(`${path}:${command.line} transient npx execution is prohibited; use committed locked tooling`);
    }
    if (programmaticNpmExecutionIsUsed(content)) errors.push(`${path} programmatic npm execution is prohibited; use a governed shell command`);
  }
  const aggregate = readText("script/verify_release.sh");
  if (!aggregate.includes("validate_npm_supply_chain.mjs")) errors.push("script/verify_release.sh must invoke the npm supply-chain validator");
  const releasePackager = readText("script/package_release.sh");
  validateReleasePackagerBoundary(releasePackager, errors);
  validateMcpbBuilderBoundary(readText("script/build_mcpb_release.sh"), errors);
  const workflow = readText(".github/workflows/release-integrity.yml");
  validateLiveAuditGateSources(aggregate, workflow, errors);
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
    ".github/actions/**",
    ".gitattributes",
    "package-lock.json",
    "**/package-lock.json",
    "npm-shrinkwrap.json",
    "**/npm-shrinkwrap.json",
    ".npmrc",
    "**/.npmrc",
    "**/*.sh",
    "**/*.bash",
    "**/*.zsh",
    "package.json",
    "**/package.json",
    "**/*.js",
    "**/*.jsx",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.ts",
    "**/*.cts",
    "**/*.mts",
    "**/*.tsx",
    "Dockerfile",
    "**/Dockerfile",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "docs/reports/m0-issue-17-repository-baseline.md",
    "docs/security/**",
  ]) {
    if (!workflow.includes(`- "${trigger}"`)) errors.push(`release-integrity.yml must trigger on ${trigger}`);
  }
  const mcpPackage = readJSON("services/mcp/package.json");
  if (mcpPackage.scripts?.["pack:mcpb"] !== "../../script/build_mcpb_release.sh ./project-ambient-control.mcpb") {
    errors.push("services/mcp pack:mcpb must use the committed locked MCPB builder");
  }
  const mcpReadme = readText("services/mcp/README.md");
  if (!mcpReadme.includes("native Windows `cmd.exe` packaging is not yet\nclaimed")) {
    errors.push("services/mcp README must retain the explicit Bash/Windows MCPB packaging boundary");
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

function makeSyntheticResidualFinding(overrides = {}) {
  return {
    advisory: "GHSA-aaaa-bbbb-cccc",
    package: "synthetic-low-package",
    nodePath: "node_modules/synthetic-low-package",
    severity: "low",
    workspace: "apps/site",
    disposition: "tracked-development-only-major-fix-deferred",
    reason: "Synthetic low-severity development-only identity retained solely to exercise closed policy cardinality and live reconciliation behavior.",
    ...overrides,
  };
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
tamper("residual severity promoted", (value) => {
  value.auditPolicy.workspaces[0].counts.low = 1;
  value.auditPolicy.workspaces[0].counts.total = 1;
  value.auditPolicy.residualFindings.push(makeSyntheticResidualFinding({ severity: "high" }));
});
tamper("residual path hidden", (value) => {
  value.auditPolicy.workspaces[0].counts.low = 1;
  value.auditPolicy.workspaces[0].counts.total = 1;
  value.auditPolicy.residualFindings.push(makeSyntheticResidualFinding({ nodePath: "unknown" }));
});
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
  (fixtureRoot) => writeFileSync(join(fixtureRoot, "services/mcp/NPM-SHRINKWRAP.JSON"), "{}\n"),
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
    assert.ok(errors.some((error) => error.includes("npm-shrinkwrap.json is unsupported")), "case-folded npm shrinkwrap discovery");
  },
);
tamperCases.push("case-folded npm shrinkwrap discovery");
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
  "npm install-test",
  "npm install-ci-test",
  "npm isntall",
  "npm isntall-clean",
  "npm clean-install-test",
  "npm exec --package npm -- npm ci",
  "npm x npm -- ci",
  'npm "$NPM_OPERATION"',
  'npm run check "$(npm ci)"',
  "npm ci \\",
  "npm ci $NPM_FLAGS",
  "npm ci --no-ignore-scripts",
  "npm ci --ignore-scripts --ignore-scripts=false",
  "npm ci --ignore-scripts --no-ignore-scripts",
  "npm ci --ignore-scripts false",
  "npm --ignore-scripts false ci",
  "npm install-cl",
  "npm installTest",
  "npm pac .",
  "npm publ",
  "npm rebuil",
  "npm --script-shell /bin/sh ci",
  "npm --omit dev ci",
  "npm ci --ignore-scripts -ignore-scripts=false",
  "npm ci --ignore-scripts --no-ignore-script",
  "npm ci --ignore-scripts --ign=false",
  "npm ci --ignore-scripts --no-ign",
  '"npm" ci',
  "$'npm' ci",
  "\\npm ci",
  "n\\pm ci",
  "np\\m ci",
  '"/usr/bin/npm" ci',
]) {
  assert.equal(installCommandIsDenied(unsafeCommand), false, `unguarded install command: ${unsafeCommand}`);
  tamperCases.push(`unguarded install command: ${unsafeCommand}`);
}
const multilineNegation = logicalCommandLines("npm ci --ignore-scripts \\\n  --no-ignore-scripts");
assert.equal(multilineNegation.length, 1, "multiline npm command framing");
assert.equal(installCommandIsDenied(multilineNegation[0].text), false, "multiline negated ignore-scripts flag");
tamperCases.push("multiline negated ignore-scripts flag");
const foldedNegation = yamlFoldedRunCommandLines("- run: >\n    npm ci --ignore-scripts\n    --no-ignore-scripts\n");
assert.equal(foldedNegation.length, 1, "folded YAML npm command framing");
assert.equal(installCommandIsDenied(foldedNegation[0].text), false, "folded YAML negated ignore-scripts flag");
tamperCases.push("folded YAML negated ignore-scripts flag");
assert.equal(isControlledInstallFile(".github/actions/setup/action.yml"), true, "composite action command discovery");
tamperCases.push("composite action command discovery");
assert.equal(isControlledTransientExecutionFile("services/mcp/src/installer.ts"), true, "repository-wide JS command discovery");
tamperCases.push("repository-wide JS command discovery");
assert.equal(isControlledTransientExecutionFile("apps/site/app/installer.tsx"), true, "repository-wide TSX command discovery");
tamperCases.push("repository-wide TSX command discovery");
for (const indirectCommand of [
  'NPM_BIN=/usr/bin/npm; "$NPM_BIN" ci',
  'TOOL=$(command -v npm); "$TOOL" install',
  "alias installer=npm; installer ci",
  "$(command -v npm) ci",
]) {
  assert.equal(indirectNpmLifecycleIsUsed(indirectCommand), true, `indirect npm lifecycle command: ${indirectCommand}`);
  tamperCases.push(`indirect npm lifecycle command: ${indirectCommand}`);
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
validateWorkspaceRootScripts({
  scripts: Object.fromEntries([...PROHIBITED_ROOT_LIFECYCLE_SCRIPTS].map((name) => [name, `node ${name}.js`])),
}, "fixture/package.json", lifecycleScriptErrors);
for (const name of PROHIBITED_ROOT_LIFECYCLE_SCRIPTS) {
  assert.ok(lifecycleScriptErrors.some((error) => error.includes(`scripts.${name}`)), `root ${name} hook tamper`);
}
tamperCases.push("root prepack hook tamper");
assert.equal(transientNpxIsUsed('await run("npx", ["--yes", "package"])'), true, "transient npx execution");
tamperCases.push("transient npx execution");
for (const programmaticCommand of [
  'spawn("npm", ["ci"])',
  'execFileSync("npm", ["pack", "."])',
  'execFileSync("/usr/bin/npm", ["ci"])',
  'spawn(npmBinary, ["ci"])',
  'const tool = "/usr/bin/npm"; execFileSync(tool, ["ci"])',
]) {
  assert.equal(programmaticNpmExecutionIsUsed(programmaticCommand), true, `programmatic npm execution: ${programmaticCommand}`);
  tamperCases.push(`programmatic npm execution: ${programmaticCommand}`);
}
for (const [label, source] of [
  ["commented release packager gate", '# node "$ROOT_DIR/script/validate_npm_supply_chain.mjs"\nnpm_config_cache="$STAGE_DIR/.npm-cache" \\\nnpm_config_userconfig=/dev/null \\\nnpm pack "$MCP_DIR" --pack-destination "$STAGE_DIR" --ignore-scripts >/dev/null\n'],
  ["late release packager gate", 'npm pack "$MCP_DIR" --pack-destination "$STAGE_DIR" --ignore-scripts >/dev/null\nnode "$ROOT_DIR/script/validate_npm_supply_chain.mjs"\n'],
  ["dead-branch release packager gate", 'if false; then\nnode "$ROOT_DIR/script/validate_npm_supply_chain.mjs"\nnpm_config_cache="$STAGE_DIR/.npm-cache" \\\nnpm_config_userconfig=/dev/null \\\nnpm pack "$MCP_DIR" --pack-destination "$STAGE_DIR" --ignore-scripts >/dev/null\nfi\n'],
  ["uncalled-function release packager gate", 'pack_archive() {\nnode "$ROOT_DIR/script/validate_npm_supply_chain.mjs"\nnpm_config_cache="$STAGE_DIR/.npm-cache" \\\nnpm_config_userconfig=/dev/null \\\nnpm pack "$MCP_DIR" --pack-destination "$STAGE_DIR" --ignore-scripts >/dev/null\n}\n'],
]) {
  const errors = [];
  validateReleasePackagerBoundary(source, errors);
  assert.ok(errors.length > 0, label);
}
tamperCases.push("release packager gate framing");
const mcpbBuilderErrors = [];
validateMcpbBuilderBoundary(
  readText("script/build_mcpb_release.sh").replace(
    'npm_config_globalconfig="$NPM_GLOBAL_CONFIG" \\',
    "npm_config_globalconfig=~/.npmrc \\",
  ),
  mcpbBuilderErrors,
);
assert.ok(mcpbBuilderErrors.length > 0, "MCPB credential-isolation boundary");
tamperCases.push("MCPB credential-isolation boundary");
const lineEndingErrors = [];
validateLineEndingPolicy(GITATTRIBUTES_BYTES.replace("eol=lf", "eol=crlf"), lineEndingErrors);
assert.ok(lineEndingErrors.length > 0, "byte-governed line endings");
tamperCases.push("byte-governed line endings");
const pinnedAggregateSource = readText("script/verify_release.sh");
const pinnedWorkflowSource = readText(".github/workflows/release-integrity.yml");
const aggregateAuditLoop = `for NPM_AUDIT_WORKSPACE in apps/site script/mcpb-tooling services/mcp; do
  printf '\\n› validate live npm audit for %s\\n' "$NPM_AUDIT_WORKSPACE"
  npm --prefix "$ROOT_DIR/$NPM_AUDIT_WORKSPACE" audit --package-lock-only --audit-level=moderate --json |
    node "$ROOT_DIR/script/validate_npm_supply_chain.mjs" --validate-audit-result "$NPM_AUDIT_WORKSPACE"
done`;
assert.equal(pinnedAggregateSource.includes(aggregateAuditLoop), true, "aggregate live-audit fixture drifted");
const workflowAuditStep = `      - name: Reject moderate or higher npm advisories
        run: |`;
assert.equal(pinnedWorkflowSource.includes(workflowAuditStep), true, "workflow live-audit fixture drifted");
for (const [label, aggregateSource, workflowSource] of [
  [
    "dead aggregate live-audit gate",
    pinnedAggregateSource.replace(aggregateAuditLoop, `if false; then\n${aggregateAuditLoop}\nfi`),
    pinnedWorkflowSource,
  ],
  [
    "disabled workflow live-audit gate",
    pinnedAggregateSource,
    pinnedWorkflowSource.replace(workflowAuditStep, `${workflowAuditStep}\n        if: \${{ false }}`),
  ],
]) {
  const errors = [];
  validateLiveAuditGateSources(aggregateSource, workflowSource, errors);
  assert.ok(errors.length > 0, label);
  tamperCases.push(label);
}
for (const suppressedAudit of [
  "export npm_config_audit=false",
  "export npm_config_audit='false'",
  "NPM_CONFIG_AUDIT=0 npm ci --ignore-scripts",
  "npm ci --ignore-scripts --no-audit",
  "npm ci --ignore-scripts --no-aud",
  "npm ci --ignore-scripts --audit=\"false\"",
  "npm ci --ignore-scripts --audit false",
  "npm config set audit false",
  "npm config set audit=false",
]) {
  assert.equal(auditReportingIsSuppressed(suppressedAudit), true, `suppressed npm audit: ${suppressedAudit}`);
  tamperCases.push(`suppressed npm audit: ${suppressedAudit}`);
}
for (const workspace of EXPECTED_WORKSPACES) {
  validateLiveAuditResult(policy, workspace, JSON.stringify(makeLiveAuditFixture(policy, workspace)));
}
const multiIdentityPolicy = structuredClone(policy);
multiIdentityPolicy.auditPolicy.workspaces[0].counts.low = 1;
multiIdentityPolicy.auditPolicy.workspaces[0].counts.total = 1;
multiIdentityPolicy.auditPolicy.residualFindings = [
  makeSyntheticResidualFinding(),
  makeSyntheticResidualFinding({ advisory: "GHSA-dddd-eeee-ffff" }),
];
assert.deepEqual(
  validatePolicyShape(multiIdentityPolicy),
  [],
  "one low package with multiple advisory identities must be representable",
);
const multiIdentityAudit = JSON.stringify(makeLiveAuditFixture(multiIdentityPolicy, "apps/site"));
validateLiveAuditResult(multiIdentityPolicy, "apps/site", multiIdentityAudit);
for (const [label, mutate] of [
  ["fabricated residual advisory identity", (value) => { value.auditPolicy.residualFindings[0].advisory = "GHSA-gggg-hhhh-iiii"; }],
  ["wrong-workspace residual advisory identity", (value) => { value.auditPolicy.residualFindings[0].workspace = "services/mcp"; }],
  ["missing residual advisory identity", (value) => { value.auditPolicy.residualFindings.pop(); }],
]) {
  const candidate = structuredClone(multiIdentityPolicy);
  mutate(candidate);
  assert.throws(
    () => validateLiveAuditResult(candidate, "apps/site", multiIdentityAudit),
    /live npm audit residual identities drifted/,
    label,
  );
  tamperCases.push(label);
}
const duplicateResidualPolicy = structuredClone(multiIdentityPolicy);
duplicateResidualPolicy.auditPolicy.residualFindings.push(structuredClone(duplicateResidualPolicy.auditPolicy.residualFindings[0]));
assert.ok(
  validatePolicyShape(duplicateResidualPolicy).some((error) => error.includes("duplicates a residual advisory/node identity")),
  "duplicate residual advisory identity",
);
tamperCases.push("duplicate residual advisory identity");

const shapeErrors = validatePolicyShape(policy);
assert.deepEqual(shapeErrors, [], `invalid npm supply-chain policy:\n${shapeErrors.join("\n")}`);
const repositoryErrors = validateRepository(policy);
assert.deepEqual(repositoryErrors, [], `npm supply-chain repository drift:\n${repositoryErrors.join("\n")}`);

const disabledCount = policy.installPolicy.workspaces.reduce((sum, workspace) => sum + workspace.installScriptPackages.length, 0);
const residualCount = policy.auditPolicy.residualFindings.length;
console.log(`OK: ${POLICY_PATH} covers ${EXPECTED_WORKSPACES.length} locked workspaces and disables ${disabledCount} install-script packages with no exceptions`);
console.log(`OK: captured audits retain 0 moderate/high/critical findings and ${residualCount} tracked low finding`);
console.log(`self-test: all ${tamperCases.length} tamper cases rejected; validation is fail-closed`);
