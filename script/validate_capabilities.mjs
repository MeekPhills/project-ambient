#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

const schema = await readJson(schemaPath);
assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.properties?.schemaVersion?.const, 1);
assert.deepEqual(schema.$defs?.capability?.properties?.state?.enum, states);
assert.deepEqual([...schema.$defs.platform.properties.family.enum].sort(), [...platformFamilies].sort());
assert.equal(schema.properties?.capabilities?.minItems, capabilityIds.length);
assert.ok(schema.required.includes("evidenceCatalog"));
assert.ok(schema.$defs?.releaseBinding?.oneOf?.length === 2);

const filenames = (await readdir(fixtureDirectory)).filter((file) => file.endsWith(".json")).sort();
assert.deepEqual(filenames, [...platformFiles.keys()].sort(), "fixtures must contain exactly the five platform examples");

const fixtures = new Map();
for (const filename of filenames) {
  const manifest = await readJson(path.join(fixtureDirectory, filename));
  const errors = validateManifest(manifest, platformFiles.get(filename));
  assert.deepEqual(errors, [], `${filename} failed:\n${errors.join("\n")}`);
  fixtures.set(filename, manifest);
}

const macos = fixtures.get("macos.json");
const future = clone(macos);
future.schemaVersion = 2;
expectInvalid("future schema rejection", future, "schemaVersion");

const missingEvidence = clone(macos);
missingEvidence.capabilities[0].evidenceRefs = [];
expectInvalid("missing evidence rejection", missingEvidence, "evidenceRefs");

const duplicate = clone(macos);
duplicate.capabilities[1].id = duplicate.capabilities[0].id;
expectInvalid("inferred capability rejection", duplicate, "duplicate capability IDs");
expectInvalid("explicit coverage rejection", duplicate, "missing explicit states");

const badStateDetails = clone(macos);
badStateDetails.capabilities[0].state = "unavailable_by_os";
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

const incompleteArchive = clone(archived);
delete incompleteArchive.capabilities[0].stateDetails.securityStatus;
expectInvalid("incomplete archive rejection", incompleteArchive, "securityStatus");

const placeholderShippedLink = clone(fixtures.get("android.json"));
placeholderShippedLink.claimScope = "shipped_build";
expectInvalid("placeholder release digest rejection", placeholderShippedLink, "placeholder digest");

console.log(`Capability contract valid: schema v1, ${fixtures.size} platform fixtures, ${capabilityIds.length} explicit capabilities each, 7 negative/compatibility checks passed.`);
