#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registerPath = path.join(root, "docs/product/display-control-capability-register.json");
const schemaPath = path.join(root, "schemas/display-control/v1/capability-register.schema.json");

const frozenBaseline = {
  label: "stable",
  product: "BetterDisplay",
  version: "4.3.6",
  build: "50119",
  bundleId: "pro.betterdisplay.BetterDisplay",
  released: "2026-08-11",
  tagCommit: "046b59f8c04e8b46872ee270f5cee76cc1ef1803",
  landingCommit: "c71b73d5e024c793e8df7be2742017a81599b0cc",
  sourceURL: "https://github.com/waydabber/BetterDisplay/releases/tag/v4.3.6",
};

const expectedDomains = ["discovery-identity", "mode-transactions", "hidpi-custom-modes", "hdr-xdr", "color-management", "ddc-hardware-control", "software-dimming-osd", "audio", "groups-sync-presets", "virtual-displays", "disconnect-reconnect", "edid", "pip-streaming", "network-device-control", "settings-recovery", "control-plane", "privacy-security", "accessibility-localization", "updater-support", "qualification", "packaging-claims", "policy"];
const supportedBasisKinds = new Set(["public-apple-api", "app-local"]);
const adapterDomains = new Set(["ddc-hardware-control", "network-device-control"]);
const bannedCreditKeys = new Set(["score", "weight", "credit", "earned", "earnedWeight", "completion", "completionPercent", "percentComplete"]);
const supportedSchemaKeywords = new Set(["$schema", "$id", "$ref", "$defs", "title", "description", "type", "const", "enum", "pattern", "minLength", "required", "properties", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "oneOf"]);

function clone(value) { return structuredClone(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function jsonEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

function resolveReference(rootSchema, reference) {
  if (!reference.startsWith("#/")) throw new Error(`only local schema references are supported: ${reference}`);
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

function validateRegister(register, schema) {
  const errors = [...schemaErrors(register, schema)];

  const banned = findBannedKey(register);
  if (banned.length) errors.push(`register must not carry tracker credit fields: ${banned.join(", ")}`);

  if (!jsonEqual(register.requiredDomains, expectedDomains)) errors.push("requiredDomains must exactly match the accepted display-control domains and order");
  if (!jsonEqual(register.baselines?.[0], frozenBaseline)) errors.push("stable baseline must exactly bind the frozen BetterDisplay 4.3.6 release evidence");
  if (register.rowCount !== register.rows?.length) errors.push(`rowCount (${register.rowCount}) does not equal rows.length (${register.rows?.length})`);

  const evidenceIds = new Set();
  for (const evidence of register.evidenceCatalog ?? []) {
    if (evidenceIds.has(evidence.id)) errors.push(`duplicate evidence ID ${evidence.id}`);
    evidenceIds.add(evidence.id);
    if (evidence.retrievedAt !== register.retrievedAt) errors.push(`${evidence.id}: retrieval date differs from register`);
  }

  const rowIds = new Set();
  let unqualified = 0;
  const domainsSeen = new Set();
  const tierCounts = { free: 0, pro: 0, "cross-cutting": 0 };
  const dispositionCounts = {};

  for (const row of register.rows ?? []) {
    const at = row.id ?? "(missing id)";
    if (rowIds.has(row.id)) errors.push(`${at}: duplicate row ID`);
    rowIds.add(row.id);
    domainsSeen.add(row.domain);
    if (Object.hasOwn(tierCounts, row.comparatorTier)) tierCounts[row.comparatorTier] += 1;
    dispositionCounts[row.disposition] = (dispositionCounts[row.disposition] ?? 0) + 1;

    for (const reference of row.evidenceRefs ?? []) if (!evidenceIds.has(reference)) errors.push(`${at}: evidence reference ${reference} is not in the evidence catalog`);

    const kinds = (row.apiBasis ?? []).map((basis) => basis.kind);
    const gates = new Set(row.claimGates ?? []);

    if (row.disposition === "supported") {
      for (const kind of kinds) if (!supportedBasisKinds.has(kind)) errors.push(`${at}: supported row carries basis kind ${kind}; only public-apple-api or app-local is allowed in the Supported Display Core`);
    }
    if (kinds.includes("private-spi-risk") && !["experimental", "blocked", "unavailable"].includes(row.disposition)) errors.push(`${at}: private-spi-risk basis requires disposition experimental, blocked, or unavailable`);
    if (kinds.includes("os-undocumented") && row.disposition === "supported") errors.push(`${at}: os-undocumented basis cannot be supported`);
    if (row.disposition === "experimental" && (!gates.has("opt-in") || !gates.has("adapter-packaging"))) errors.push(`${at}: experimental row must gate on opt-in and adapter-packaging`);
    if (adapterDomains.has(row.domain) && row.disposition === "experimental") {
      for (const gate of ["timeout", "kill-switch", "hardware-matrix"]) if (!gates.has(gate)) errors.push(`${at}: ${row.domain} adapter row missing required gate ${gate}`);
    }
    if (row.domain === "pip-streaming" && row.disposition === "supported") {
      for (const gate of ["consent", "screen-recording-permission"]) if (!gates.has(gate)) errors.push(`${at}: pip-streaming supported row missing required gate ${gate}`);
    }
    if (row.implementationStatus === "qualified" && row.testBinding?.startsWith("planned:")) errors.push(`${at}: qualified row cannot carry a planned-only test binding`);
    if (row.implementationStatus !== "qualified") unqualified += 1;
  }

  for (const domain of expectedDomains) if (!domainsSeen.has(domain)) errors.push(`domain ${domain} has no rows`);
  if (tierCounts.free !== 40) errors.push(`register must carry exactly 40 free-tier comparator rows (found ${tierCounts.free})`);
  if (tierCounts.pro !== 37) errors.push(`register must carry exactly 37 pro-tier comparator rows (found ${tierCounts.pro})`);
  if (unqualified > 0 && register.launchGate?.fullReplacementClaim !== false) errors.push(`launchGate.fullReplacementClaim must be false while ${unqualified} rows are unqualified`);

  return { errors, summary: { rows: register.rows?.length ?? 0, tierCounts, dispositionCounts, unqualified } };
}

function selfTest(register, schema) {
  const cases = [
    ["baseline drift", (r) => { r.baselines[0].version = "4.3.4"; }],
    ["rowCount drift", (r) => { r.rowCount += 1; }],
    ["duplicate row ID", (r) => { r.rows[1].id = r.rows[0].id; }],
    ["hidden credit field", (r) => { r.rows[0].score = 1; }],
    ["dangling evidence reference", (r) => { r.rows[0].evidenceRefs = ["MISSING"]; }],
    ["private SPI claimed supported", (r) => { r.rows.find((x) => x.apiBasis.some((b) => b.kind === "private-spi-risk")).disposition = "supported"; }],
    ["undocumented mechanism claimed supported", (r) => { r.rows.find((x) => x.disposition === "experimental" && x.apiBasis.some((b) => b.kind === "os-undocumented")).disposition = "supported"; }],
    ["experimental without opt-in", (r) => { const row = r.rows.find((x) => x.disposition === "experimental"); row.claimGates = row.claimGates.filter((g) => g !== "opt-in"); }],
    ["DDC adapter without kill-switch", (r) => { const row = r.rows.find((x) => x.domain === "ddc-hardware-control"); row.claimGates = row.claimGates.filter((g) => g !== "kill-switch"); }],
    ["streaming without consent", (r) => { const row = r.rows.find((x) => x.domain === "pip-streaming" && x.disposition === "supported"); row.claimGates = row.claimGates.filter((g) => g !== "consent"); }],
    ["premature full-replacement claim", (r) => { r.launchGate.fullReplacementClaim = true; }],
    ["qualified without evidence", (r) => { r.rows[0].implementationStatus = "qualified"; }],
    ["dropped free-tier row", (r) => { const index = r.rows.findIndex((x) => x.comparatorTier === "free"); r.rows.splice(index, 1); r.rowCount -= 1; }],
  ];
  const failures = [];
  for (const [name, tamper] of cases) {
    const tampered = clone(register);
    tamper(tampered);
    if (validateRegister(tampered, schema).errors.length === 0) failures.push(name);
    else console.log(`self-test ok: ${name} rejected`);
  }
  return failures;
}

const register = await readJson(registerPath);
const schema = await readJson(schemaPath);

const schemaAudit = auditSchema(schema);
if (schemaAudit.length) {
  console.error(`FAIL: schema uses unsupported keywords`);
  for (const finding of schemaAudit) console.error(`  - ${finding}`);
  process.exit(1);
}

const { errors, summary } = validateRegister(register, schema);
if (errors.length) {
  console.error(`FAIL: ${errors.length} finding(s) in ${path.relative(root, registerPath)}`);
  for (const finding of errors) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`OK: ${path.relative(root, registerPath)}`);
console.log(JSON.stringify(summary, null, 2));

const failures = selfTest(register, schema);
if (failures.length) {
  console.error(`FAIL: self-test tamper cases not rejected: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`self-test: all 13 tamper cases rejected; validation is fail-closed`);
