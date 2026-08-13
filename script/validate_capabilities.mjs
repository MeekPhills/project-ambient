#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "schemas/capabilities/v1/capability-manifest.schema.json");
const fixtureDirectory = path.join(root, "fixtures/capabilities/v1");

const platformFiles = new Map([
  ["android.json", "android"],
  ["ios-ipados.json", "ios_ipados"],
  ["linux.json", "linux"],
  ["macos.json", "macos"],
  ["windows.json", "windows"],
]);

const capabilityIds = [
  "wallpaper.static",
  "wallpaper.live",
  "screen_saver",
  "lock_screen",
  "displays.independent",
  "displays.same_source",
  "displays.synchronized",
  "displays.spanned",
  "overlays",
  "solar.rules",
  "lifecycle.lock",
  "lifecycle.login_logout",
  "lifecycle.power",
  "lifecycle.camera",
  "lifecycle.occlusion",
  "secure_storage",
  "package.install",
  "package.update",
  "remote.control",
  "mobile.wallpaper_action",
];

const states = [
  "supported",
  "experimental",
  "unavailable_by_os",
  "unavailable_by_build",
  "archived",
];

const platformFamilies = [...platformFiles.values()];
const architectureValues = ["arm64", "x86_64"];
const integrationMethods = [
  "native_wallpaper_api",
  "screen_saver_extension",
  "desktop_shell_adapter",
  "wallpaper_service",
  "device_management",
  "app_intents",
  "remote_companion",
  "none",
];
const lifecycleValues = ["preview", "current", "maintenance", "legacy", "archived"];
const channels = ["development", "nightly", "alpha", "beta", "stable", "archived"];
const evidenceTypes = ["contract_fixture", "source", "test", "release", "platform_documentation", "issue"];
const supportedSchemaKeywords = new Set([
  "$schema", "$id", "$ref", "$defs",
  "title", "description",
  "type", "const", "enum", "format", "pattern", "minLength",
  "required", "properties", "propertyNames", "additionalProperties", "minProperties",
  "items", "minItems", "uniqueItems",
  "allOf", "oneOf", "if", "then", "else",
]);

const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const revision = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const evidenceId = /^[a-z0-9][a-z0-9._-]*$/;

function clone(value) {
  return structuredClone(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveLocalReference(rootSchema, reference) {
  assert.ok(reference.startsWith("#/"), `only local JSON Schema references are supported: ${reference}`);
  return reference.slice(2).split("/").reduce((value, segment) => {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    return value?.[key];
  }, rootSchema);
}

function auditSchemaKeywords(rule, at = "$", errors = []) {
  if (typeof rule === "boolean") return errors;
  if (!isObject(rule)) {
    errors.push(`${at}: schema node must be an object or boolean`);
    return errors;
  }
  for (const key of Object.keys(rule)) {
    if (!supportedSchemaKeywords.has(key)) errors.push(`${at}: unsupported JSON Schema keyword ${key}`);
  }
  for (const [key, subrule] of Object.entries(rule.$defs ?? {})) auditSchemaKeywords(subrule, `${at}.$defs.${key}`, errors);
  for (const [key, subrule] of Object.entries(rule.properties ?? {})) auditSchemaKeywords(subrule, `${at}.properties.${key}`, errors);
  if (rule.propertyNames !== undefined) auditSchemaKeywords(rule.propertyNames, `${at}.propertyNames`, errors);
  if (isObject(rule.additionalProperties) || typeof rule.additionalProperties === "boolean") auditSchemaKeywords(rule.additionalProperties, `${at}.additionalProperties`, errors);
  if (rule.items !== undefined) auditSchemaKeywords(rule.items, `${at}.items`, errors);
  for (const keyword of ["allOf", "oneOf"]) {
    (rule[keyword] ?? []).forEach((subrule, index) => auditSchemaKeywords(subrule, `${at}.${keyword}[${index}]`, errors));
  }
  for (const keyword of ["if", "then", "else"]) {
    if (rule[keyword] !== undefined) auditSchemaKeywords(rule[keyword], `${at}.${keyword}`, errors);
  }
  return errors;
}

function schemaErrors(value, rule, at = "$", rootSchema = rule) {
  if (rule === true) return [];
  if (rule === false) return [`${at}: rejected by schema`];
  if (!isObject(rule)) return [`${at}: invalid schema rule`];

  if (rule.$ref) {
    const target = resolveLocalReference(rootSchema, rule.$ref);
    return target ? schemaErrors(value, target, at, rootSchema) : [`${at}: unresolved schema reference ${rule.$ref}`];
  }

  const errors = [];
  const matchesType = {
    object: isObject(value),
    array: Array.isArray(value),
    string: typeof value === "string",
    number: typeof value === "number" && Number.isFinite(value),
    integer: Number.isInteger(value),
    boolean: typeof value === "boolean",
    null: value === null,
  };
  if (rule.type && !matchesType[rule.type]) {
    errors.push(`${at}: expected ${rule.type}`);
    return errors;
  }
  if (Object.hasOwn(rule, "const") && !jsonEqual(value, rule.const)) errors.push(`${at}: expected constant ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.some((item) => jsonEqual(item, value))) errors.push(`${at}: value is not in enum`);

  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${at}: shorter than minLength ${rule.minLength}`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${at}: does not match pattern ${rule.pattern}`);
    if (rule.format === "date-time" && !isDateTime(value)) errors.push(`${at}: invalid date-time`);
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${at}: fewer than minItems ${rule.minItems}`);
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${at}: array items are not unique`);
    if (rule.items) {
      value.forEach((item, index) => errors.push(...schemaErrors(item, rule.items, `${at}[${index}]`, rootSchema)));
    }
  }

  if (isObject(value)) {
    if (rule.minProperties !== undefined && Object.keys(value).length < rule.minProperties) errors.push(`${at}: fewer than minProperties ${rule.minProperties}`);
    if (rule.required) {
      for (const key of rule.required) if (!Object.hasOwn(value, key)) errors.push(`${at}: missing required property ${key}`);
    }
    if (rule.propertyNames) {
      for (const key of Object.keys(value)) errors.push(...schemaErrors(key, rule.propertyNames, `${at}{property:${key}}`, rootSchema));
    }
    const declared = rule.properties ?? {};
    for (const [key, propertyRule] of Object.entries(declared)) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], propertyRule, `${at}.${key}`, rootSchema));
    }
    const extras = Object.keys(value).filter((key) => !Object.hasOwn(declared, key));
    if (rule.additionalProperties === false) {
      for (const key of extras) errors.push(`${at}: unknown property ${key}`);
    } else if (isObject(rule.additionalProperties) || typeof rule.additionalProperties === "boolean") {
      for (const key of extras) errors.push(...schemaErrors(value[key], rule.additionalProperties, `${at}.${key}`, rootSchema));
    }
  }

  if (rule.allOf) {
    for (const subrule of rule.allOf) errors.push(...schemaErrors(value, subrule, at, rootSchema));
  }
  if (rule.if) {
    const conditionMatches = schemaErrors(value, rule.if, at, rootSchema).length === 0;
    if (conditionMatches && rule.then) errors.push(...schemaErrors(value, rule.then, at, rootSchema));
    if (!conditionMatches && rule.else) errors.push(...schemaErrors(value, rule.else, at, rootSchema));
  }
  if (rule.oneOf) {
    const alternatives = rule.oneOf.map((subrule) => schemaErrors(value, subrule, at, rootSchema));
    const matchCount = alternatives.filter((candidate) => candidate.length === 0).length;
    if (matchCount !== 1) errors.push(`${at}: expected exactly one oneOf match, received ${matchCount}`);
  }
  return errors;
}

function exactKeys(value, allowed, at, errors) {
  if (!isObject(value)) {
    errors.push(`${at}: expected object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${at}: unknown property ${key}`);
  }
}

function requireString(value, at, errors, minimum = 1) {
  if (typeof value !== "string" || value.length < minimum) errors.push(`${at}: expected string length >= ${minimum}`);
}

function validateReleaseBinding(binding, claimScope, errors) {
  if (!isObject(binding)) {
    errors.push("releaseBinding: expected object");
    return;
  }
  const mediaType = "application/vnd.project-ambient.capabilities+json;version=1";
  if (binding.mediaType !== mediaType) errors.push("releaseBinding.mediaType: unsupported capability media type");
  if (binding.mode === "embedded") {
    exactKeys(binding, ["mode", "assetPath", "mediaType"], "releaseBinding", errors);
    if (typeof binding.assetPath !== "string" || binding.assetPath.startsWith("/") || binding.assetPath.includes("..") || !binding.assetPath.endsWith(".json")) {
      errors.push("releaseBinding.assetPath: expected safe relative JSON path");
    }
  } else if (binding.mode === "linked") {
    exactKeys(binding, ["mode", "url", "sha256", "mediaType"], "releaseBinding", errors);
    if (typeof binding.url !== "string" || !binding.url.startsWith("https://")) errors.push("releaseBinding.url: expected HTTPS URL");
    if (!digest.test(binding.sha256 ?? "")) errors.push("releaseBinding.sha256: expected lowercase SHA-256");
    if (claimScope === "shipped_build" && /^0{64}$/.test(binding.sha256 ?? "")) errors.push("releaseBinding.sha256: shipped build cannot use a placeholder digest");
  } else {
    errors.push("releaseBinding.mode: expected embedded or linked");
  }
}

function validateEvidenceCatalog(catalog, errors) {
  if (!isObject(catalog) || Object.keys(catalog).length === 0) {
    errors.push("evidenceCatalog: expected at least one evidence record");
    return;
  }
  for (const [id, evidence] of Object.entries(catalog)) {
    if (!evidenceId.test(id)) errors.push(`evidenceCatalog.${id}: invalid evidence ID`);
    exactKeys(evidence, ["type", "uri", "summary", "verifiedAt"], `evidenceCatalog.${id}`, errors);
    if (!evidenceTypes.includes(evidence?.type)) errors.push(`evidenceCatalog.${id}.type: unsupported evidence type`);
    if (typeof evidence?.uri !== "string" || !evidence.uri.startsWith("https://")) errors.push(`evidenceCatalog.${id}.uri: expected HTTPS URL`);
    requireString(evidence?.summary, `evidenceCatalog.${id}.summary`, errors, 12);
    if (evidence?.verifiedAt !== undefined && !isDateTime(evidence.verifiedAt)) errors.push(`evidenceCatalog.${id}.verifiedAt: expected date-time`);
  }
}

function validateStateDetails(capability, at, errors) {
  const details = capability.stateDetails;
  if (!isObject(details)) {
    errors.push(`${at}.stateDetails: expected object`);
    return;
  }
  switch (capability.state) {
    case "supported":
      exactKeys(details, ["sinceBuild", "verification"], `${at}.stateDetails`, errors);
      requireString(details.sinceBuild, `${at}.stateDetails.sinceBuild`, errors);
      requireString(details.verification, `${at}.stateDetails.verification`, errors);
      break;
    case "experimental":
      exactKeys(details, ["sinceBuild", "limitations", "fallbackCapabilityId"], `${at}.stateDetails`, errors);
      requireString(details.sinceBuild, `${at}.stateDetails.sinceBuild`, errors);
      if (!Array.isArray(details.limitations) || details.limitations.length === 0 || details.limitations.some((item) => typeof item !== "string" || item.length === 0)) {
        errors.push(`${at}.stateDetails.limitations: expected non-empty string array`);
      }
      if (!capabilityIds.includes(details.fallbackCapabilityId)) errors.push(`${at}.stateDetails.fallbackCapabilityId: unknown capability`);
      break;
    case "unavailable_by_os":
      exactKeys(details, ["reasonCode", "osConstraint"], `${at}.stateDetails`, errors);
      if (!/^os_[a-z0-9_]+$/.test(details.reasonCode ?? "")) errors.push(`${at}.stateDetails.reasonCode: expected os_* code`);
      requireString(details.osConstraint, `${at}.stateDetails.osConstraint`, errors);
      break;
    case "unavailable_by_build":
      exactKeys(details, ["reasonCode", "plannedMilestone"], `${at}.stateDetails`, errors);
      if (!/^build_[a-z0-9_]+$/.test(details.reasonCode ?? "")) errors.push(`${at}.stateDetails.reasonCode: expected build_* code`);
      if (!/^M[0-8]$/.test(details.plannedMilestone ?? "")) errors.push(`${at}.stateDetails.plannedMilestone: expected M0-M8`);
      break;
    case "archived":
      exactKeys(details, ["lastSupportedBuild", "archivedAt", "securityStatus"], `${at}.stateDetails`, errors);
      requireString(details.lastSupportedBuild, `${at}.stateDetails.lastSupportedBuild`, errors);
      if (!isDateTime(details.archivedAt)) errors.push(`${at}.stateDetails.archivedAt: expected date-time`);
      if (!["no_security_updates", "critical_fixes_only"].includes(details.securityStatus)) errors.push(`${at}.stateDetails.securityStatus: invalid archived security state`);
      break;
    default:
      break;
  }
}

function validateManifest(manifest, expectedFamily) {
  const errors = [];
  exactKeys(manifest, ["schemaVersion", "manifestVersion", "claimScope", "generatedAt", "build", "platform", "releaseBinding", "evidenceCatalog", "capabilities"], "$", errors);
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion: this reader supports major version 1 only");
  if (!semver.test(manifest.manifestVersion ?? "")) errors.push("manifestVersion: expected SemVer");
  if (!["contract_fixture", "shipped_build"].includes(manifest.claimScope)) errors.push("claimScope: unsupported scope");
  if (!isDateTime(manifest.generatedAt)) errors.push("generatedAt: expected date-time");

  exactKeys(manifest.build, ["product", "version", "channel", "sourceRevision"], "build", errors);
  if (manifest.build?.product !== "Project Ambient") errors.push("build.product: expected Project Ambient");
  if (!semver.test(manifest.build?.version ?? "")) errors.push("build.version: expected SemVer");
  if (!channels.includes(manifest.build?.channel)) errors.push("build.channel: unsupported channel");
  if (!revision.test(manifest.build?.sourceRevision ?? "")) errors.push("build.sourceRevision: expected 40-character Git revision");

  exactKeys(manifest.platform, ["family", "displayName", "versionRange", "architectures", "environment", "integrationMethods", "supportLifecycle"], "platform", errors);
  if (!platformFamilies.includes(manifest.platform?.family)) errors.push("platform.family: unsupported family");
  if (expectedFamily && manifest.platform?.family !== expectedFamily) errors.push(`platform.family: expected ${expectedFamily} for fixture`);
  requireString(manifest.platform?.displayName, "platform.displayName", errors);
  exactKeys(manifest.platform?.versionRange, ["minimum", "maximumTested"], "platform.versionRange", errors);
  requireString(manifest.platform?.versionRange?.minimum, "platform.versionRange.minimum", errors);
  requireString(manifest.platform?.versionRange?.maximumTested, "platform.versionRange.maximumTested", errors);
  if (!Array.isArray(manifest.platform?.architectures) || manifest.platform.architectures.length === 0 || manifest.platform.architectures.some((value) => !architectureValues.includes(value)) || new Set(manifest.platform.architectures).size !== manifest.platform.architectures.length) {
    errors.push("platform.architectures: expected unique supported architecture values");
  }
  if (!Array.isArray(manifest.platform?.integrationMethods) || manifest.platform.integrationMethods.length === 0 || manifest.platform.integrationMethods.some((value) => !integrationMethods.includes(value)) || new Set(manifest.platform.integrationMethods).size !== manifest.platform.integrationMethods.length) {
    errors.push("platform.integrationMethods: expected unique declared methods");
  }
  if (!lifecycleValues.includes(manifest.platform?.supportLifecycle)) errors.push("platform.supportLifecycle: invalid lifecycle");
  if (manifest.platform?.environment !== undefined && (!isObject(manifest.platform.environment) || Object.values(manifest.platform.environment).some((value) => typeof value !== "string" || value.length === 0))) {
    errors.push("platform.environment: expected string-valued object");
  }

  validateReleaseBinding(manifest.releaseBinding, manifest.claimScope, errors);
  validateEvidenceCatalog(manifest.evidenceCatalog, errors);

  if (!Array.isArray(manifest.capabilities)) {
    errors.push("capabilities: expected array");
    return errors;
  }
  const ids = manifest.capabilities.map((capability) => capability?.id);
  if (new Set(ids).size !== ids.length) errors.push("capabilities: duplicate capability IDs");
  const missing = capabilityIds.filter((id) => !ids.includes(id));
  const unknown = ids.filter((id) => !capabilityIds.includes(id));
  if (missing.length > 0) errors.push(`capabilities: missing explicit states for ${missing.join(", ")}`);
  if (unknown.length > 0) errors.push(`capabilities: unknown IDs ${unknown.join(", ")}`);

  for (const [index, capability] of manifest.capabilities.entries()) {
    const at = `capabilities[${index}]`;
    exactKeys(capability, ["id", "state", "explanation", "evidenceRefs", "stateDetails"], at, errors);
    if (!states.includes(capability?.state)) errors.push(`${at}.state: unsupported state`);
    requireString(capability?.explanation, `${at}.explanation`, errors, 20);
    if (!Array.isArray(capability?.evidenceRefs) || capability.evidenceRefs.length === 0 || new Set(capability.evidenceRefs).size !== capability.evidenceRefs.length) {
      errors.push(`${at}.evidenceRefs: expected unique non-empty references`);
    } else {
      for (const ref of capability.evidenceRefs) {
        if (!Object.hasOwn(manifest.evidenceCatalog ?? {}, ref)) errors.push(`${at}.evidenceRefs: unknown evidence ${ref}`);
      }
    }
    validateStateDetails(capability, at, errors);

    if (manifest.claimScope === "shipped_build" && ["supported", "experimental"].includes(capability.state)) {
      const records = (capability.evidenceRefs ?? []).map((ref) => manifest.evidenceCatalog?.[ref]).filter(Boolean);
      if (!records.some((record) => ["source", "test", "release", "platform_documentation"].includes(record.type))) {
        errors.push(`${at}.evidenceRefs: shipped support requires source, test, release, or platform evidence`);
      }
    }
  }
  return errors;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function expectInvalid(name, manifest, expectedFragment) {
  const errors = validateManifest(manifest, manifest.platform?.family);
  assert.ok(errors.some((error) => error.includes(expectedFragment)), `${name}: expected ${expectedFragment}; got ${errors.join(" | ")}`);
}

async function verifyEmbeddedBinding(manifest, releaseRoot) {
  assert.equal(manifest.releaseBinding.mode, "embedded", "embedded verification requires embedded binding");
  const boundPath = path.resolve(releaseRoot, manifest.releaseBinding.assetPath);
  assert.ok(boundPath.startsWith(`${path.resolve(releaseRoot)}${path.sep}`), "embedded manifest must remain inside the release root");
  const boundManifest = await readJson(boundPath);
  assert.deepEqual(schemaErrors(boundManifest, schema), [], "embedded release manifest must validate against the published schema");
  assert.deepEqual(validateManifest(boundManifest, boundManifest.platform.family), [], "embedded release manifest must pass semantic validation");
}

function linkedClaimIdentity(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    manifestVersion: manifest.manifestVersion,
    claimScope: manifest.claimScope,
    build: manifest.build,
    platform: manifest.platform,
    evidenceCatalog: manifest.evidenceCatalog,
    capabilities: manifest.capabilities,
  };
}

async function verifyLinkedBinding(manifest, loadLinkedContent) {
  assert.equal(manifest.releaseBinding.mode, "linked", "linked verification requires linked binding");
  const bytes = await loadLinkedContent(manifest.releaseBinding.url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, manifest.releaseBinding.sha256, "linked release manifest digest must match fetched bytes");
  const linkedManifest = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(schemaErrors(linkedManifest, schema), [], "linked release manifest must validate against the published schema");
  assert.deepEqual(validateManifest(linkedManifest, linkedManifest.platform.family), [], "linked release manifest must pass semantic validation");
  assert.deepEqual(linkedClaimIdentity(linkedManifest), linkedClaimIdentity(manifest), "linked release manifest must describe the same build, platform, evidence, and capability claims as the linking envelope");
}

const schema = await readJson(schemaPath);
assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.deepEqual(auditSchemaKeywords(schema), [], "published schema uses a keyword unsupported by the in-repo evaluator");
assert.equal(schema.properties?.schemaVersion?.const, 1);
assert.deepEqual(schema.$defs?.capability?.properties?.state?.enum, states);
assert.deepEqual([...schema.$defs.platform.properties.family.enum].sort(), [...platformFamilies].sort());
assert.equal(schema.properties?.capabilities?.minItems, capabilityIds.length);
assert.ok(schema.required.includes("evidenceCatalog"));
assert.ok(schema.$defs?.releaseBinding?.oneOf?.length === 2);

const unsupportedKeywordSchema = clone(schema);
unsupportedKeywordSchema.properties.manifestVersion.maxLength = 12;
assert.ok(auditSchemaKeywords(unsupportedKeywordSchema).some((error) => error.includes("unsupported JSON Schema keyword maxLength")), "schema audit must fail closed on an unsupported validation keyword");

const filenames = (await readdir(fixtureDirectory)).filter((file) => file.endsWith(".json")).sort();
assert.deepEqual(filenames, [...platformFiles.keys()].sort(), "fixtures must contain exactly the five platform examples");

const fixtures = new Map();
for (const filename of filenames) {
  const manifest = await readJson(path.join(fixtureDirectory, filename));
  const structuralErrors = schemaErrors(manifest, schema);
  assert.deepEqual(structuralErrors, [], `${filename} failed JSON Schema validation:\n${structuralErrors.join("\n")}`);
  const errors = validateManifest(manifest, platformFiles.get(filename));
  assert.deepEqual(errors, [], `${filename} failed:\n${errors.join("\n")}`);
  fixtures.set(filename, manifest);
}

const macos = fixtures.get("macos.json");
const future = clone(macos);
future.schemaVersion = 2;
assert.ok(schemaErrors(future, schema).some((error) => error.includes("schemaVersion")), "JSON Schema must reject a future major version");
expectInvalid("future schema rejection", future, "schemaVersion");

const missingEvidence = clone(macos);
missingEvidence.capabilities[0].evidenceRefs = [];
assert.ok(schemaErrors(missingEvidence, schema).some((error) => error.includes("evidenceRefs")), "JSON Schema must reject missing evidence references");
expectInvalid("missing evidence rejection", missingEvidence, "evidenceRefs");

const duplicate = clone(macos);
duplicate.capabilities[1].id = duplicate.capabilities[0].id;
expectInvalid("inferred capability rejection", duplicate, "duplicate capability IDs");
expectInvalid("explicit coverage rejection", duplicate, "missing explicit states");

const badStateDetails = clone(macos);
badStateDetails.capabilities[0].state = "unavailable_by_os";
assert.ok(schemaErrors(badStateDetails, schema).some((error) => error.includes("stateDetails")), "JSON Schema must enforce state-specific fields");
expectInvalid("state-specific contract rejection", badStateDetails, "expected os_* code");

const archived = clone(fixtures.get("windows.json"));
archived.capabilities[0] = {
  id: "wallpaper.static",
  state: "archived",
  explanation: "This fixture demonstrates an archived capability with an explicit security boundary.",
  evidenceRefs: ["contract-issue"],
  stateDetails: { lastSupportedBuild: "0.0.0-example", archivedAt: "2026-08-13T18:00:00Z", securityStatus: "no_security_updates" },
};
assert.deepEqual(validateManifest(archived, "windows"), [], "archived state should validate when support and security fields are explicit");
assert.deepEqual(schemaErrors(archived, schema), [], "JSON Schema should accept a complete archived state");

const incompleteArchive = clone(archived);
delete incompleteArchive.capabilities[0].stateDetails.securityStatus;
assert.ok(schemaErrors(incompleteArchive, schema).some((error) => error.includes("securityStatus")), "JSON Schema must reject incomplete archived state");
expectInvalid("incomplete archive rejection", incompleteArchive, "securityStatus");

const placeholderShippedLink = clone(fixtures.get("android.json"));
placeholderShippedLink.releaseBinding = {
  mode: "linked",
  url: "https://example.invalid/capabilities.json",
  sha256: "0".repeat(64),
  mediaType: "application/vnd.project-ambient.capabilities+json;version=1",
};
placeholderShippedLink.claimScope = "shipped_build";
expectInvalid("placeholder release digest rejection", placeholderShippedLink, "placeholder digest");

const releaseRoot = await mkdtemp(path.join(os.tmpdir(), "project-ambient-capability-release-"));
try {
  const embedded = clone(macos);
  const embeddedPath = path.join(releaseRoot, embedded.releaseBinding.assetPath);
  await mkdir(path.dirname(embeddedPath), { recursive: true });
  await writeFile(embeddedPath, `${JSON.stringify(embedded, null, 2)}\n`);
  await verifyEmbeddedBinding(embedded, releaseRoot);

  const linkedBytes = Buffer.from(`${JSON.stringify(fixtures.get("android.json"), null, 2)}\n`);
  const linked = clone(fixtures.get("android.json"));
  linked.releaseBinding = {
    mode: "linked",
    url: "https://fixtures.project-ambient.invalid/android-capabilities.json",
    sha256: createHash("sha256").update(linkedBytes).digest("hex"),
    mediaType: "application/vnd.project-ambient.capabilities+json;version=1",
  };
  await verifyLinkedBinding(linked, async (url) => {
    assert.equal(url, linked.releaseBinding.url, "linked verifier must request the declared immutable URL");
    return linkedBytes;
  });

  const tampered = clone(linked);
  tampered.releaseBinding.sha256 = "f".repeat(64);
  await assert.rejects(() => verifyLinkedBinding(tampered, async () => linkedBytes), /digest must match/);

  const wrongPlatform = clone(linked);
  wrongPlatform.platform = clone(fixtures.get("windows.json").platform);
  await assert.rejects(() => verifyLinkedBinding(wrongPlatform, async () => linkedBytes), /same build, platform, evidence, and capability claims/);
} finally {
  await rm(releaseRoot, { recursive: true, force: true });
}

console.log(`Capability contract valid: schema v1, ${fixtures.size} platform fixtures, ${capabilityIds.length} explicit capabilities each, fail-closed published-schema evaluation plus 8 negative/compatibility and 4 release-binding checks passed.`);
