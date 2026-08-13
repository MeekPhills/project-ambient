#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = path.join(root, "docs/product/aerial-parity.json");
const schemaPath = path.join(root, "schemas/aerial-parity/v1/aerial-parity.schema.json");
const planPath = path.join(root, "docs/product/implementation-plan.json");

const expectedDomains = ["install-update","screensaver-lock","wallpaper","fullscreen","apple-content","personal-media","playlists-channels","filters","live-feeds","content-packs","displays","time-solar","energy-lifecycle","transitions","overlays","cache","privacy","diagnostics","playback-details"];
const expectedDirections = ["static", "hybrid", "advanced-live"];
const allowedOwners = ["Sol", "Luna", "Terra"];
const allowedDispositions = ["implement", "improve", "exception"];
const allowedStatuses = ["planned", "partial", "implemented", "verified"];
const allowedTestStatuses = ["planned", "implemented", "passed"];
const frozenDocumentationCommit = "a9c94622a2db978bdfaa9a72a7228dbad6019573";
const bannedCreditKeys = new Set(["score", "weight", "credit", "earned", "earnedWeight", "completion", "completionPercent", "percentComplete"]);
const supportedSchemaKeywords = new Set(["$schema", "$id", "$ref", "$defs", "title", "description", "type", "const", "enum", "pattern", "minLength", "required", "properties", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "oneOf"]);

function clone(value) { return structuredClone(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function jsonEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

function resolveReference(rootSchema, reference) {
  assert.ok(reference.startsWith("#/"), `only local schema references are supported: ${reference}`);
  return reference.slice(2).split("/").reduce((value, raw) => value?.[raw.replaceAll("~1", "/").replaceAll("~0", "~")], rootSchema);
}

function auditSchema(rule, at = "$", errors = []) {
  if (typeof rule === "boolean") return errors;
  if (!isObject(rule)) return [...errors, `${at}: schema node must be an object or boolean`];
  for (const key of Object.keys(rule)) if (!supportedSchemaKeywords.has(key)) errors.push(`${at}: unsupported schema keyword ${key}`);
  for (const [key, child] of Object.entries(rule.$defs ?? {})) auditSchema(child, `${at}.$defs.${key}`, errors);
  for (const [key, child] of Object.entries(rule.properties ?? {})) auditSchema(child, `${at}.properties.${key}`, errors);
  if (rule.additionalProperties !== undefined && rule.additionalProperties !== false && rule.additionalProperties !== true) auditSchema(rule.additionalProperties, `${at}.additionalProperties`, errors);
  if (rule.items !== undefined) auditSchema(rule.items, `${at}.items`, errors);
  (rule.oneOf ?? []).forEach((child, index) => auditSchema(child, `${at}.oneOf[${index}]`, errors));
  return errors;
}

function schemaErrors(value, rule, at = "$", rootSchema = rule) {
  if (rule === true) return [];
  if (rule === false) return [`${at}: rejected by schema`];
  if (rule.$ref) {
    const target = resolveReference(rootSchema, rule.$ref);
    return target ? schemaErrors(value, target, at, rootSchema) : [`${at}: unresolved reference ${rule.$ref}`];
  }
  const errors = [];
  const types = { object: isObject(value), array: Array.isArray(value), string: typeof value === "string", number: typeof value === "number" && Number.isFinite(value), integer: Number.isInteger(value), boolean: typeof value === "boolean", null: value === null };
  if (rule.type && !types[rule.type]) return [`${at}: expected ${rule.type}`];
  if (Object.hasOwn(rule, "const") && !jsonEqual(value, rule.const)) errors.push(`${at}: expected constant ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.some((candidate) => jsonEqual(candidate, value))) errors.push(`${at}: value not in enum`);
  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${at}: shorter than minLength ${rule.minLength}`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${at}: does not match ${rule.pattern}`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${at}: fewer than ${rule.minItems} items`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${at}: more than ${rule.maxItems} items`);
    if (rule.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) errors.push(`${at}: items are not unique`);
    if (rule.items) value.forEach((item, index) => errors.push(...schemaErrors(item, rule.items, `${at}[${index}]`, rootSchema)));
  }
  if (isObject(value)) {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}: missing ${key}`);
    const properties = rule.properties ?? {};
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], child, `${at}.${key}`, rootSchema));
    const extras = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
    if (rule.additionalProperties === false) extras.forEach((key) => errors.push(`${at}: unknown property ${key}`));
    else if (isObject(rule.additionalProperties) || typeof rule.additionalProperties === "boolean") extras.forEach((key) => errors.push(...schemaErrors(value[key], rule.additionalProperties, `${at}.${key}`, rootSchema)));
  }
  if (rule.oneOf) {
    const count = rule.oneOf.filter((child) => schemaErrors(value, child, at, rootSchema).length === 0).length;
    if (count !== 1) errors.push(`${at}: expected one oneOf match; received ${count}`);
  }
  return errors;
}

function findBannedKey(value, at = "$", findings = []) {
  if (Array.isArray(value)) value.forEach((item, index) => findBannedKey(item, `${at}[${index}]`, findings));
  else if (isObject(value)) for (const [key, child] of Object.entries(value)) {
    if (bannedCreditKeys.has(key)) findings.push(`${at}.${key}`);
    findBannedKey(child, `${at}.${key}`, findings);
  }
  return findings;
}

function validateMatrix(matrix, plan, { ga = false } = {}) {
  const errors = [];
  if (!jsonEqual(matrix.requiredDomains, expectedDomains)) errors.push("requiredDomains must exactly match the accepted launch-spec domains and order");
  if (!jsonEqual(matrix.requiredProductDirections, expectedDirections)) errors.push("requiredProductDirections must exactly match static, hybrid, advanced-live");
  if (findBannedKey(matrix).length) errors.push(`matrix must not carry tracker credit fields: ${findBannedKey(matrix).join(", ")}`);
  const resourceBudget = matrix.crossCuttingConformance?.resourceBudget;
  const chatControl = matrix.crossCuttingConformance?.chatControl;
  const expectedMeasures = ["cpu", "memory", "wakeups", "gpu", "decoder", "network", "storage-churn", "frame-pacing"];
  if (resourceBudget?.requirementRef !== "https://github.com/MeekPhills/project-ambient/issues/28" || resourceBudget?.applicability !== "every-row" || resourceBudget?.referenceTier !== "base-2024-m4-mac-mini-16gb-256gb" || resourceBudget?.conformanceTest?.id !== "PAR-XCUT-M4" || !jsonEqual(resourceBudget?.measures, expectedMeasures)) errors.push("cross-cutting contract #28 must map every row to the exact base-M4 resource conformance suite");
  if (chatControl?.requirementRef !== "https://github.com/MeekPhills/project-ambient/issues/29" || chatControl?.applicability !== "every-row" || chatControl?.directMode !== "required-for-setting-or-action" || chatControl?.deterministicChatMode !== "same-typed-command-required" || chatControl?.nonActionBehavior !== "explain-read-only-or-unsupported" || chatControl?.conformanceTest?.id !== "PAR-XCUT-CHAT") errors.push("cross-cutting contract #29 must map every row to direct/chat conformance or an explicit read-only explanation");
  for (const [name, suite] of [["#28", resourceBudget?.conformanceTest], ["#29", chatControl?.conformanceTest]]) {
    if (suite?.status === "passed" && !suite.evidenceRefs?.length) errors.push(`cross-cutting contract ${name} passed suite requires durable evidence`);
    if (ga && suite?.status !== "passed") errors.push(`GA requires cross-cutting contract ${name} suite passed`);
    if (ga && !suite?.evidenceRefs?.length) errors.push(`GA requires cross-cutting contract ${name} evidence`);
  }

  const baselineByLabel = new Map((matrix.baselines ?? []).map((entry) => [entry.label, entry]));
  if (matrix.baselines?.length !== 2 || baselineByLabel.size !== 2) errors.push("baselines must contain exactly one stable and one beta record");
  const stable = baselineByLabel.get("stable");
  const beta = baselineByLabel.get("beta");
  if (stable?.tag !== "v4.0.14" || stable?.commit !== "15f9c35b9db69795325eab608fa00f11ef13a0a3" || stable?.sourceURL !== "https://github.com/AerialScreensaver/Aerial/tree/v4.0.14") errors.push("stable baseline must exactly bind tag, commit, and source URL");
  if (beta?.tag !== "v4.1.0beta13" || beta?.commit !== "0083c721dcc0fa6df55a0a011678c11493ad2810" || beta?.sourceURL !== "https://github.com/AerialScreensaver/Aerial/tree/v4.1.0beta13") errors.push("beta baseline must exactly bind tag, commit, and source URL");
  const baselineCommits = new Set([...baselineByLabel.values()].map((entry) => entry.commit));

  const evidenceById = new Map();
  for (const evidence of matrix.evidenceCatalog ?? []) {
    if (evidenceById.has(evidence.id)) errors.push(`duplicate evidence ID ${evidence.id}`);
    evidenceById.set(evidence.id, evidence);
    if (evidence.retrievedAt !== matrix.retrievedAt) errors.push(`${evidence.id}: retrieval date differs from matrix`);
    if (evidence.kind === "source") {
      if (!baselineCommits.has(evidence.sourceCommit)) errors.push(`${evidence.id}: source commit is not a frozen Aerial baseline`);
      const expectedVersion = evidence.sourceCommit === "15f9c35b9db69795325eab608fa00f11ef13a0a3" ? "v4.0.14" : "v4.1.0beta13";
      if (evidence.sourceVersion !== expectedVersion) errors.push(`${evidence.id}: sourceVersion does not match its frozen source commit`);
      if (!evidence.uri.startsWith(`https://github.com/AerialScreensaver/Aerial/blob/${evidence.sourceCommit}/`)) errors.push(`${evidence.id}: source URI must bind exact Aerial repository and commit`);
    } else if (evidence.kind === "official-documentation") {
      if (evidence.sourceCommit !== frozenDocumentationCommit) errors.push(`${evidence.id}: documentation commit differs from frozen gh-pages evidence`);
      if (evidence.sourceVersion !== "gh-pages@2026-08-13") errors.push(`${evidence.id}: sourceVersion does not match its frozen documentation commit`);
      if (!evidence.uri.startsWith(`https://github.com/AerialScreensaver/aerialscreensaver.github.io/blob/${evidence.sourceCommit}/`)) errors.push(`${evidence.id}: documentation URI must be an immutable gh-pages blob`);
    }
  }
  for (const baseline of baselineByLabel.values()) if (![...evidenceById.values()].some((evidence) => evidence.sourceCommit === baseline.commit)) errors.push(`${baseline.label}: baseline has no evidence record`);

  const tasks = new Map((plan.tasks ?? []).map((task) => [task.id, task]));
  const rowIds = new Set();
  const testIds = new Set();
  const domainsSeen = new Set();
  const directionsSeen = new Set();
  for (const [index, row] of (matrix.rows ?? []).entries()) {
    const at = `rows[${index}](${row?.id ?? "missing"})`;
    if (rowIds.has(row.id)) errors.push(`${at}: duplicate row ID`);
    rowIds.add(row.id);
    if (testIds.has(row.test?.id)) errors.push(`${at}: duplicate test ID ${row.test?.id}`);
    testIds.add(row.test?.id);
    if (!expectedDomains.includes(row.domain)) errors.push(`${at}: unknown domain ${row.domain}`);
    domainsSeen.add(row.domain);
    for (const direction of row.productDirections ?? []) {
      if (!expectedDirections.includes(direction)) errors.push(`${at}: unknown product direction ${direction}`);
      directionsSeen.add(direction);
    }
    if (!allowedOwners.includes(row.owner)) errors.push(`${at}: invalid owner`);
    if (!allowedDispositions.includes(row.launchDisposition)) errors.push(`${at}: invalid launch disposition`);
    if (!allowedStatuses.includes(row.implementationStatus)) errors.push(`${at}: invalid implementation status`);
    if (!allowedTestStatuses.includes(row.test?.status)) errors.push(`${at}: invalid test status`);
    if (row.implementationStatus === "planned" && row.test?.status !== "planned") errors.push(`${at}: planned implementation cannot claim a non-planned test`);
    if (row.implementationStatus === "verified" && row.test?.status !== "passed") errors.push(`${at}: verified implementation requires passed test evidence`);
    if (row.launchDisposition === "exception" && !isObject(row.exception)) errors.push(`${at}: exception disposition requires a complete exception`);
    if (row.launchDisposition !== "exception" && row.exception !== null) errors.push(`${at}: non-exception row must use null exception`);
    if (isObject(row.exception)) {
      if (row.exception.approvalStatus === "pending" && row.exception.approvalEvidence !== null) errors.push(`${at}: pending exception cannot claim approval evidence`);
      if (row.exception.approvalStatus === "approved" && (typeof row.exception.approvalEvidence !== "string" || !row.exception.approvalEvidence.startsWith("https://github.com/MeekPhills/project-ambient/"))) errors.push(`${at}: approved exception requires durable approval evidence`);
    }
    if (ga) {
      if (row.implementationStatus !== "verified") errors.push(`${at}: GA requires verified implementation`);
      if (row.test?.status !== "passed") errors.push(`${at}: GA requires passed test evidence`);
      if (row.launchDisposition === "exception" && row.exception?.approvalStatus !== "approved") errors.push(`${at}: GA requires approved exception`);
    }
    const task = tasks.get(row.implementationTaskId);
    if (!task) errors.push(`${at}: unknown implementation task ${row.implementationTaskId}`);
    else {
      if (task.milestone !== row.milestone) errors.push(`${at}: task milestone mismatch`);
      if (task.owner !== row.owner) errors.push(`${at}: task owner mismatch`);
      if (task.issueRef !== row.issueRef) errors.push(`${at}: task issue reference mismatch`);
    }
    if (!row.evidenceRefs?.length) errors.push(`${at}: evidence required`);
    for (const ref of row.evidenceRefs ?? []) if (!evidenceById.has(ref)) errors.push(`${at}: unknown evidence ${ref}`);
  }
  for (const domain of expectedDomains) if (!domainsSeen.has(domain)) errors.push(`missing launch domain ${domain}`);
  for (const direction of expectedDirections) if (!directionsSeen.has(direction)) errors.push(`missing product direction ${direction}`);
  return errors;
}

function expectInvalid(name, matrix, plan, fragment) {
  const structural = schemaErrors(matrix, schema);
  const semantic = validateMatrix(matrix, plan);
  const errors = [...structural, ...semantic];
  assert.ok(errors.some((error) => error.includes(fragment)), `${name}: expected ${fragment}; got ${errors.join(" | ")}`);
}

const [schema, matrix, plan] = await Promise.all([readJson(schemaPath), readJson(matrixPath), readJson(planPath)]);
assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.deepEqual(auditSchema(schema), [], "published parity schema contains an unsupported keyword");
assert.deepEqual(schemaErrors(matrix, schema), [], "parity matrix failed its published JSON Schema");
assert.deepEqual(validateMatrix(matrix, plan), [], "parity matrix failed semantic validation");

const unsupportedSchema = clone(schema);
unsupportedSchema.properties.matrixVersion.maxLength = 8;
assert.ok(auditSchema(unsupportedSchema).some((error) => error.includes("unsupported schema keyword maxLength")), "schema audit must fail closed on unknown constraints");

const future = clone(matrix); future.schemaVersion = 2;
expectInvalid("future schema", future, plan, "schemaVersion");
const missingOwner = clone(matrix); delete missingOwner.rows[0].owner;
expectInvalid("missing owner", missingOwner, plan, "owner");
const unknownEvidence = clone(matrix); unknownEvidence.rows[0].evidenceRefs = ["does-not-exist"];
expectInvalid("unknown evidence", unknownEvidence, plan, "unknown evidence");
const duplicateRow = clone(matrix); duplicateRow.rows[1].id = duplicateRow.rows[0].id;
expectInvalid("duplicate row", duplicateRow, plan, "duplicate row ID");
const duplicateTest = clone(matrix); duplicateTest.rows[1].test.id = duplicateTest.rows[0].test.id;
expectInvalid("duplicate test", duplicateTest, plan, "duplicate test ID");
const wrongTask = clone(matrix); wrongTask.rows[0].implementationTaskId = "m1-onboarding-import";
expectInvalid("task ownership", wrongTask, plan, "task milestone mismatch");
const missingException = clone(matrix); const exceptionIndex = missingException.rows.findIndex((row) => row.launchDisposition === "exception"); missingException.rows[exceptionIndex].exception = null;
expectInvalid("missing exception", missingException, plan, "exception disposition");
const fakeVerified = clone(matrix); fakeVerified.rows[0].implementationStatus = "verified";
expectInvalid("unproved implementation", fakeVerified, plan, "verified implementation requires passed test");
const missingDomain = clone(matrix); missingDomain.rows = missingDomain.rows.filter((row) => row.domain !== "fullscreen");
expectInvalid("missing domain", missingDomain, plan, "missing launch domain fullscreen");
const creditInjection = clone(matrix); creditInjection.rows[0].weight = 1;
expectInvalid("credit injection", creditInjection, plan, "tracker credit fields");
const wrongVersion = clone(matrix); wrongVersion.evidenceCatalog[0].sourceVersion = "v0.0.0";
expectInvalid("source version binding", wrongVersion, plan, "sourceVersion does not match");
const wrongOrigin = clone(matrix); wrongOrigin.evidenceCatalog[0].uri = `https://example.invalid/Aerial/blob/${wrongOrigin.evidenceCatalog[0].sourceCommit}/Aerial.swift`;
expectInvalid("source origin binding", wrongOrigin, plan, "exact Aerial repository");
const extraBaseline = clone(matrix); extraBaseline.baselines.push(clone(extraBaseline.baselines[0]));
expectInvalid("extra baseline", extraBaseline, plan, "exactly one stable and one beta");
const duplicateBaseline = clone(matrix); duplicateBaseline.baselines[1].label = "stable";
expectInvalid("duplicate baseline label", duplicateBaseline, plan, "exactly one stable and one beta");
const mismatchedBaseline = clone(matrix); mismatchedBaseline.baselines[0].sourceURL = "https://github.com/AerialScreensaver/Aerial/tree/v4.1.0beta13";
expectInvalid("baseline source mismatch", mismatchedBaseline, plan, "stable baseline must exactly bind");
const missingM4Contract = clone(matrix); missingM4Contract.crossCuttingConformance.resourceBudget.applicability = "selected-rows";
expectInvalid("missing base-M4 mapping", missingM4Contract, plan, "contract #28 must map every row");
const missingChatContract = clone(matrix); missingChatContract.crossCuttingConformance.chatControl.applicability = "selected-rows";
expectInvalid("missing chat mapping", missingChatContract, plan, "contract #29 must map every row");

const gaErrors = validateMatrix(matrix, plan, { ga: true });
assert.ok(gaErrors.some((error) => error.includes("GA requires verified implementation")), "GA gate must reject planned implementation");
assert.ok(gaErrors.some((error) => error.includes("GA requires passed test evidence")), "GA gate must reject planned tests");
assert.ok(gaErrors.some((error) => error.includes("GA requires approved exception")), "GA gate must reject pending exceptions");
assert.ok(gaErrors.some((error) => error.includes("contract #28 suite passed")), "GA gate must reject planned base-M4 conformance");
assert.ok(gaErrors.some((error) => error.includes("contract #29 suite passed")), "GA gate must reject planned chat conformance");
const gaReady = clone(matrix);
for (const row of gaReady.rows) {
  row.implementationStatus = "verified";
  row.test.status = "passed";
  if (row.exception) {
    row.exception.approvalStatus = "approved";
    row.exception.approvalEvidence = "https://github.com/MeekPhills/project-ambient/issues/18#issuecomment-example";
  }
}
for (const key of ["resourceBudget", "chatControl"]) {
  gaReady.crossCuttingConformance[key].conformanceTest.status = "passed";
  gaReady.crossCuttingConformance[key].conformanceTest.evidenceRefs = ["https://github.com/MeekPhills/project-ambient/issues/18#issuecomment-example"];
}
assert.deepEqual(validateMatrix(gaReady, plan, { ga: true }), [], "synthetic complete matrix must pass the future GA gate");

if (process.argv.includes("--ga")) {
  if (gaErrors.length > 0) {
    console.error(`GA parity gate failed with ${gaErrors.length} finding(s):`);
    console.error(gaErrors.slice(0, 20).join("\n"));
    if (gaErrors.length > 20) console.error(`... ${gaErrors.length - 20} additional finding(s) omitted`);
    process.exit(1);
  }
}

const counts = Object.fromEntries(expectedDomains.map((domain) => [domain, matrix.rows.filter((row) => row.domain === domain).length]));
console.log(`Aerial parity matrix valid: schema v${matrix.schemaVersion}, ${matrix.rows.length} owned rows across ${expectedDomains.length} domains and ${expectedDirections.length} product directions; ${matrix.evidenceCatalog.length} version-bound evidence records; 23 negative/fail-closed checks and the synthetic GA gate passed.`);
console.log(`Domain coverage: ${Object.entries(counts).map(([domain, count]) => `${domain}=${count}`).join(", ")}`);
