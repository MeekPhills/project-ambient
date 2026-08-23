#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "../services/mcp/node_modules/ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "schemas/resource-budgets/v1/static-wakeup-preflight.schema.json");
const sourcePath = path.join(root, "script/macos_static_wakeup_preflight.m");
const planPath = path.join(root, "fixtures/resource-budgets/v1/base-m4-static-wakeup-qualification-plan.json");
const expectedPlanSHA256 = "c071f4cd6032d4d961853df8aa3820365d31dd5c369c19edcd56e182d58c0069";
const expectedProducerRevision = "d97acf7d042a3138fae086e02f5aada2cfcc8116";
const expectedSchemaSHA256 = "52112392f43cbf7fd7a1038f70a24a4b5c82e1ff8db2e0a4bcf1568fb755a9e0";
const expectedSourceSHA256 = "6a959914532e033862967a95826fe6821a7313809c3092a8fa5fd91fcbb5728d";
const sha256Pattern = /^(?!0{64}$)[a-f0-9]{64}$/;
const revisionPattern = /^(?!0{40}$)[a-f0-9]{40}$/;

const resultKeys = [
  "schemaVersion", "contractId", "artifactKind", "claimScope",
  "producerRevision", "qualificationPlanSHA256", "candidate",
  "operatingSystem", "checks", "status", "stopReason",
  "remainingOwnerAttestations",
];
const candidateKeys = [
  "version", "sourceRevision", "releaseManifestSHA256",
  "macosArchiveSHA256", "executableSHA256", "architecture",
  "buildConfiguration", "artifactKind", "cleanSource",
];
const checkKeys = [
  "planCollectionReady", "candidateArtifactsMatch",
  "runningExecutableMatches", "nativeArm64", "prohibitedArgumentsAbsent",
  "freshProcessIdentity", "publicMachineFactsMatch", "acPower",
  "lowPowerModeOff", "thermalNominal", "persistedAmbientSubsetMatches",
  "displayFixtureMatches",
];
const ownerAttestations = [
  "factory-base-machine-configuration", "hdr-off",
  "fixed-still-applied-to-both-displays", "ambient-windows-hidden",
  "no-user-interaction-or-transition",
  "no-competing-controller-or-diagnostic",
];
const checkStopReasons = {
  candidateArtifactsMatch: "candidate-artifacts-mismatch",
  runningExecutableMatches: "running-executable-mismatch",
  nativeArm64: "non-native-architecture",
  prohibitedArgumentsAbsent: "prohibited-arguments-present",
  freshProcessIdentity: "process-identity-mismatch",
  publicMachineFactsMatch: "public-machine-facts-mismatch",
  acPower: "ac-power-required",
  lowPowerModeOff: "low-power-mode-enabled",
  thermalNominal: "thermal-state-not-nominal",
  persistedAmbientSubsetMatches: "persisted-state-mismatch",
  displayFixtureMatches: "display-fixture-mismatch",
};
const precheckStopReasons = [
  "plan-not-collection-ready",
  "plan-binding-mismatch",
];
const prohibitedFields = [
  "eligible", "conforms", "score", "evidence", "collectionAuthorized",
  "pid", "processStartToken", "absoluteTimestamp", "path", "filename",
  "username", "hostUUID", "bootUUID", "hardwareSerial", "displayID",
  "displaySerial", "vendorID", "productID", "edid", "registryID",
  "environment", "arguments", "rawTopology", "logPayload",
];

function exactKeys(value, keys, at) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${at} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${at} has unexpected or missing keys`);
}

function canonicalJSONString(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSONString).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSONString(value[key])}`).join(",")}}`;
}

function assertNoProhibitedFields(value, at = "preflight") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProhibitedFields(entry, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(prohibitedFields.includes(key), false, `${at} retains prohibited field ${key}`);
    assertNoProhibitedFields(child, `${at}.${key}`);
  }
}

function validateCandidate(candidate) {
  exactKeys(candidate, candidateKeys, "preflight.candidate");
  assert.match(candidate.version, /^[0-9]{1,5}[.][0-9]{1,5}[.][0-9]{1,5}$/);
  assert.match(candidate.sourceRevision, revisionPattern);
  for (const key of ["releaseManifestSHA256", "macosArchiveSHA256", "executableSHA256"]) {
    assert.match(candidate[key], sha256Pattern, `preflight.candidate.${key} must be a SHA-256 digest`);
  }
  assert.equal(candidate.architecture, "arm64");
  assert.equal(candidate.buildConfiguration, "release");
  assert.ok(["unsigned-candidate", "signed-notarized-candidate"].includes(candidate.artifactKind));
  assert.equal(candidate.cleanSource, true);
}

function validateOperatingSystem(operatingSystem) {
  exactKeys(operatingSystem, ["version", "build"], "preflight.operatingSystem");
  assert.match(operatingSystem.version, /^[0-9]{1,2}(?:[.][0-9]{1,2}){1,2}$/);
  assert.match(operatingSystem.build, /^[0-9]{2}[A-Z][0-9]{1,4}[a-z]?$/);
}

function validateResult(value, { allowCollectionReady = false } = {}) {
  exactKeys(value, resultKeys, "preflight");
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.contractId, "base-m4-static-settled-hidden-wakeups-preflight-v1");
  assert.equal(value.artifactKind, "automated-preflight-result");
  assert.equal(value.claimScope, "automated-preflight-only");
  assert.equal(value.producerRevision, expectedProducerRevision, "preflight output must bind the exact native source producer revision");
  assert.equal(value.qualificationPlanSHA256, expectedPlanSHA256);
  assert.deepEqual(value.remainingOwnerAttestations, ownerAttestations);
  exactKeys(value.checks, checkKeys, "preflight.checks");
  for (const key of checkKeys) assert.equal(typeof value.checks[key], "boolean", `preflight.checks.${key} must be boolean`);
  assertNoProhibitedFields(value);

  if (!value.checks.planCollectionReady) {
    assert.equal(value.candidate, null, "a precheck stop cannot retain candidate facts");
    assert.equal(value.operatingSystem, null, "a precheck stop cannot retain operating-system facts");
    assert.ok(checkKeys.every((key) => value.checks[key] === false), "a precheck stop cannot imply a host check ran");
    assert.equal(value.status, "stop");
    assert.ok(precheckStopReasons.includes(value.stopReason));
    return value;
  }

  assert.equal(allowCollectionReady, true, "the active null-still plan cannot emit a checked stop or pass");

  if (value.candidate === null || value.operatingSystem === null) {
    assert.equal(value.candidate, null, "unavailable host facts cannot retain a partial candidate");
    assert.equal(value.operatingSystem, null, "unavailable host facts cannot retain a partial operating system");
    assert.ok(checkKeys.slice(1).every((key) => value.checks[key] === false), "unavailable host facts cannot imply a later check ran");
    assert.equal(value.status, "stop");
    assert.equal(value.stopReason, "public-fact-unavailable");
    return value;
  }

  validateCandidate(value.candidate);
  validateOperatingSystem(value.operatingSystem);
  const failedCheck = checkKeys.slice(1).find((key) => !value.checks[key]);
  if (failedCheck) {
    assert.equal(value.status, "stop");
    assert.equal(value.stopReason, checkStopReasons[failedCheck], "the first failed check must determine the stop reason");
    return value;
  }
  assert.equal(value.status, "pass");
  assert.equal(value.stopReason, null);
  return value;
}

function validateWireOutput(input, options) {
  assert.ok(Buffer.byteLength(input, "utf8") <= 8192, "preflight output exceeds 8192 bytes");
  assert.equal(input.endsWith("\n"), true, "preflight output must end in exactly one LF");
  const json = input.slice(0, -1);
  assert.ok(json.length > 0, "preflight output is empty");
  assert.equal(json.includes("\n"), false, "preflight output must contain exactly one JSON line");
  assert.equal(json.includes("\r"), false, "preflight output must use LF, not CRLF");
  assert.equal(json.startsWith("\uFEFF"), false, "preflight output cannot start with a BOM");
  const value = JSON.parse(json);
  assert.equal(json, canonicalJSONString(value), "preflight output must use exact canonical JSON encoding");
  return validateResult(value, options);
}

function makeChecks(value = true) {
  return Object.fromEntries(checkKeys.map((key) => [key, value]));
}

function makeCandidate() {
  return {
    version: "0.1.0",
    sourceRevision: "b".repeat(40),
    releaseManifestSHA256: "1".repeat(64),
    macosArchiveSHA256: "2".repeat(64),
    executableSHA256: "3".repeat(64),
    architecture: "arm64",
    buildConfiguration: "release",
    artifactKind: "unsigned-candidate",
    cleanSource: true,
  };
}

function makeResult(overrides = {}) {
  return {
    schemaVersion: 1,
    contractId: "base-m4-static-settled-hidden-wakeups-preflight-v1",
    artifactKind: "automated-preflight-result",
    claimScope: "automated-preflight-only",
    producerRevision: expectedProducerRevision,
    qualificationPlanSHA256: expectedPlanSHA256,
    candidate: makeCandidate(),
    operatingSystem: { version: "15.0", build: "24A1" },
    checks: makeChecks(),
    status: "pass",
    stopReason: null,
    remainingOwnerAttestations: [...ownerAttestations],
    ...overrides,
  };
}

function makePrecheckStop(reason = "plan-not-collection-ready") {
  return makeResult({
    candidate: null,
    operatingSystem: null,
    checks: makeChecks(false),
    status: "stop",
    stopReason: reason,
  });
}

function makeHostUnavailable() {
  const checks = makeChecks(false);
  checks.planCollectionReady = true;
  return makeResult({
    candidate: null,
    operatingSystem: null,
    checks,
    status: "stop",
    stopReason: "public-fact-unavailable",
  });
}

function validateSchemaContract(schema) {
  exactKeys(schema, ["$schema", "$id", "title", "oneOf", "$defs"], "schema");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.oneOf, [{ $ref: "#/$defs/currentPlanStop" }], "the active null-still schema must accept only a precheck stop");
  exactKeys(schema.$defs, [
    "sha256", "revision", "candidate", "operatingSystem", "checks",
    "result", "currentPlanStop", "hostFactUnavailable", "checkedStop", "pass",
  ], "schema.$defs");
  for (const key of ["candidate", "operatingSystem", "checks", "result"]) {
    assert.equal(schema.$defs[key].additionalProperties, false, `schema.$defs.${key} must be closed`);
  }
  assert.deepEqual(schema.$defs.result.required, resultKeys);
  assert.deepEqual(schema.$defs.candidate.required, candidateKeys);
  assert.deepEqual(schema.$defs.checks.required, checkKeys);
  assert.equal(schema.$defs.result.properties.contractId.const, "base-m4-static-settled-hidden-wakeups-preflight-v1");
  assert.equal(schema.$defs.result.properties.artifactKind.const, "automated-preflight-result");
  assert.equal(schema.$defs.result.properties.claimScope.const, "automated-preflight-only");
  assert.equal(schema.$defs.result.properties.producerRevision.const, expectedProducerRevision);
  assert.equal(schema.$defs.result.properties.qualificationPlanSHA256.const, expectedPlanSHA256);
  assert.deepEqual(schema.$defs.result.properties.remainingOwnerAttestations.const, ownerAttestations);
  assert.equal(schema.$defs.candidate.properties.version.pattern, "^[0-9]{1,5}[.][0-9]{1,5}[.][0-9]{1,5}$");
  assert.equal(schema.$defs.operatingSystem.properties.version.pattern, "^[0-9]{1,2}(?:[.][0-9]{1,2}){1,2}$");
  assert.equal(schema.$defs.operatingSystem.properties.build.pattern, "^[0-9]{2}[A-Z][0-9]{1,4}[a-z]?$");
  assert.deepEqual(schema.$defs.currentPlanStop.allOf[1].properties.stopReason.enum, precheckStopReasons);
  const unavailableProperties = schema.$defs.hostFactUnavailable.allOf[1].properties;
  assert.equal(unavailableProperties.candidate.type, "null");
  assert.equal(unavailableProperties.operatingSystem.type, "null");
  assert.equal(unavailableProperties.checks.properties.planCollectionReady.const, true);
  for (const key of checkKeys.slice(1)) assert.equal(unavailableProperties.checks.properties[key].const, false);
  assert.equal(unavailableProperties.status.const, "stop");
  assert.equal(unavailableProperties.stopReason.const, "public-fact-unavailable");
  assert.deepEqual(schema.$defs.checkedStop.allOf[1].properties.stopReason.enum, Object.values(checkStopReasons));
  const checkedStopBranches = schema.$defs.checkedStop.allOf[2].oneOf;
  assert.equal(checkedStopBranches.length, Object.keys(checkStopReasons).length, "every checked stop reason needs one closed schema branch");
  Object.entries(checkStopReasons).forEach(([failedKey, reason], index) => {
    const branch = checkedStopBranches[index];
    const expectedChecks = Object.fromEntries(
      checkKeys.slice(1, index + 2).map((key) => [key, { const: key !== failedKey }]),
    );
    assert.deepEqual(branch.properties.checks.properties, expectedChecks, `checked-stop schema branch ${index} has incorrect precedence`);
    assert.equal(branch.properties.stopReason.const, reason, `checked-stop schema branch ${index} has the wrong reason`);
  });
  assert.equal(schema.$defs.pass.allOf[1].properties.status.const, "pass");
  assert.equal(schema.$defs.pass.allOf[1].properties.stopReason.type, "null");
  for (const key of checkKeys) {
    assert.equal(schema.$defs.currentPlanStop.allOf[1].properties.checks.properties[key].const, false);
    assert.equal(schema.$defs.pass.allOf[1].properties.checks.properties[key].const, true);
  }
  const serialized = JSON.stringify(schema);
  for (const field of prohibitedFields) {
    assert.equal(serialized.includes(`\"${field}\"`), false, `schema admits prohibited field ${field}`);
  }
}

function strictValidatorFor(schema, definition = null) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  if (definition === null) return ajv.compile(schema);
  return ajv.compile({
    $schema: schema.$schema,
    $defs: schema.$defs,
    $ref: `#/$defs/${definition}`,
  });
}

function occurrences(source, token) {
  return source.split(token).length - 1;
}

function validateSourceContract(source) {
  const imports = [...source.matchAll(/^#import <([^>]+)>$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["Foundation/Foundation.h", "CommonCrypto/CommonDigest.h"]);
  assert.equal(occurrences(source, "AMBIENT_PREFLIGHT_TESTING"), 4, "test injection must remain compile-time gated");
  assert.match(source, /if \(argc != 1\)/, "production preflight must reject every argument");
  assert.equal(occurrences(source, "dataWithContentsOfFile:"), 1, "production may read only the fixed plan before the gate");
  assert.equal(occurrences(source, "provider(&error)"), 1, "host facts must cross one closed callback boundary");
  assert.equal(occurrences(source, "AmbientUnavailableHostFacts(error)"), 1, "the current production host boundary must fail closed");
  assert.ok(source.includes(`@\"${expectedPlanSHA256}\"`), "source must pin the exact qualification plan bytes");
  const gateStart = source.indexOf("static NSDictionary *AmbientRunPreflight(");
  const gateEnd = source.indexOf("static NSString *AmbientSHA256", gateStart);
  const gate = source.slice(gateStart, gateEnd);
  const nullStill = gate.indexOf("fixedStill == nil || fixedStill == [NSNull null]");
  const digestCheck = gate.indexOf("AmbientValidSHA256(fixedStill)");
  const hostCallback = gate.indexOf("provider(&error)");
  assert.ok(nullStill >= 0 && digestCheck > nullStill && hostCallback > digestCheck, "plan readiness must precede every host callback");
  for (const token of [
    "private Apple", "IORegistry", "IOService", "EDID", "system_profiler",
    "log stream", "log show", "Instruments", "System Trace", "NSTask",
    "popen(", "system(", "proc_pid_rusage", "CGDisplayCreateUUIDFromDisplayID",
    "hardwareSerial", "displaySerial", "vendorID", "productID",
  ]) {
    assert.equal(source.includes(token), false, `native preflight source contains prohibited token ${token}`);
  }
  assert.equal(createHash("sha256").update(source).digest("hex"), expectedSourceSHA256, "native preflight source changed outside the reviewed boundary");
}

function runSelfTests(schema, schemaBytes, source, planBytes) {
  assert.equal(createHash("sha256").update(schemaBytes).digest("hex"), expectedSchemaSHA256, "preflight schema bytes drifted");
  assert.equal(createHash("sha256").update(planBytes).digest("hex"), expectedPlanSHA256, "qualification plan bytes drifted");
  const plan = JSON.parse(planBytes);
  assert.equal(plan.scenario.fixedNonPersonalStillSHA256, null, "the active plan must remain collection-blocked");
  assert.equal(plan.collectionState.coverage.scenarioWakeups, "unmeasured");
  validateSchemaContract(schema);
  validateSourceContract(source);
  const activeSchemaValidator = strictValidatorFor(schema);
  const unavailableSchemaValidator = strictValidatorFor(schema, "hostFactUnavailable");
  const checkedStopSchemaValidator = strictValidatorFor(schema, "checkedStop");
  const passSchemaValidator = strictValidatorFor(schema, "pass");

  const currentPositives = [
    makePrecheckStop(),
    makePrecheckStop("plan-binding-mismatch"),
  ];
  for (const value of currentPositives) {
    validateWireOutput(`${canonicalJSONString(value)}\n`);
    assert.equal(activeSchemaValidator(value), true, JSON.stringify(activeSchemaValidator.errors));
  }
  const futurePositives = [makeHostUnavailable(), makeResult()];
  for (const [index, value] of futurePositives.entries()) {
    validateResult(value, { allowCollectionReady: true });
    assert.throws(() => validateWireOutput(`${canonicalJSONString(value)}\n`), /active null-still plan/);
    assert.equal(activeSchemaValidator(value), false, "the active schema accepted a future-only preflight branch");
    const futureValidator = index === 0 ? unavailableSchemaValidator : passSchemaValidator;
    assert.equal(futureValidator(value), true, JSON.stringify(futureValidator.errors));
  }
  for (const [key, reason] of Object.entries(checkStopReasons)) {
    const value = makeResult();
    value.checks[key] = false;
    value.status = "stop";
    value.stopReason = reason;
    validateResult(value, { allowCollectionReady: true });
    assert.throws(() => validateWireOutput(`${canonicalJSONString(value)}\n`), /active null-still plan/);
    assert.equal(activeSchemaValidator(value), false, "the active schema accepted a future checked stop");
    assert.equal(checkedStopSchemaValidator(value), true, JSON.stringify(checkedStopSchemaValidator.errors));
  }

  const tamperCases = [
    (x) => { delete x.claimScope; },
    (x) => { x.extra = true; },
    (x) => { x.schemaVersion = 2; },
    (x) => { x.contractId = "other"; },
    (x) => { x.artifactKind = "qualification-result"; },
    (x) => { x.claimScope = "collection-authority"; },
    (x) => { x.producerRevision = "0".repeat(40); },
    (x) => { x.producerRevision = "c".repeat(40); },
    (x) => { x.qualificationPlanSHA256 = "9".repeat(64); },
    (x) => { x.candidate.architecture = "x86_64"; },
    (x) => { x.candidate.executableSHA256 = "0".repeat(64); },
    (x) => { x.candidate.cleanSource = 1; },
    (x) => { x.operatingSystem.version = "123.0"; },
    (x) => { x.operatingSystem.build = "C02Z91ABCDEF"; },
    (x) => { x.operatingSystem.build = "24A12345"; },
    (x) => { x.operatingSystem.build = "unknown build"; },
    (x) => { delete x.checks.acPower; },
    (x) => { x.checks.extraCheck = true; },
    (x) => { x.checks.acPower = 1; },
    (x) => { x.status = "qualified"; },
    (x) => { x.stopReason = "display-fixture-mismatch"; },
    (x) => { x.remainingOwnerAttestations.pop(); },
    (x) => { x.eligible = true; },
    (x) => { x.pid = 1; },
    (x) => { x.path = "/private"; },
    (x) => { x.rawTopology = []; },
    (x) => { x.logPayload = "private"; },
  ];
  for (const tamper of tamperCases) {
    const value = makeResult();
    tamper(value);
    assert.throws(() => validateResult(value, { allowCollectionReady: true }));
    assert.equal(passSchemaValidator(value), false, "strict schema accepted a tampered future pass");
  }

  const semanticTamperCases = [
    (x) => { x.checks.planCollectionReady = false; },
    (x) => { x.checks.acPower = false; },
    (x) => { x.checks.acPower = false; x.status = "stop"; x.stopReason = "display-fixture-mismatch"; },
    (x) => { x.status = "stop"; x.stopReason = "public-fact-unavailable"; },
  ];
  for (const tamper of semanticTamperCases) {
    const value = makeResult();
    tamper(value);
    assert.throws(() => validateResult(value, { allowCollectionReady: true }));
    assert.equal(passSchemaValidator(value), false, "strict schema accepted a semantically invalid future pass");
  }

  const unavailableTamperCases = [
    (x) => { x.checks.planCollectionReady = false; },
    (x) => { x.checks.acPower = true; },
    (x) => { x.candidate = makeCandidate(); },
    (x) => { x.operatingSystem = { version: "15.0", build: "24A1" }; },
    (x) => { x.stopReason = "plan-not-collection-ready"; },
  ];
  for (const tamper of unavailableTamperCases) {
    const value = makeHostUnavailable();
    tamper(value);
    assert.throws(() => validateResult(value, { allowCollectionReady: true }));
    assert.equal(unavailableSchemaValidator(value), false, "strict schema accepted an invalid unavailable-host result");
  }

  const canonical = canonicalJSONString(makePrecheckStop());
  const rawTamperCases = [
    canonical.replace('"status":"stop"', '"status":"pass","status":"stop"'),
    `{ ${canonical.slice(1)}`,
    ` ${canonical}\n`,
    `${canonical}\n\n`,
    `\uFEFF${canonical}\n`,
    `${canonical}\r\n`,
    canonical,
  ];
  for (const value of rawTamperCases) assert.throws(() => validateWireOutput(value));

  const schemaTamperCases = [
    (x) => { x.$defs.result.additionalProperties = true; },
    (x) => { x.$defs.checks.additionalProperties = true; },
    (x) => { x.$defs.result.required.pop(); },
    (x) => { x.$defs.checks.required.pop(); },
    (x) => { x.$defs.result.properties.claimScope.const = "qualification"; },
    (x) => { x.$defs.result.properties.producerRevision.const = "c".repeat(40); },
    (x) => { x.$defs.result.properties.qualificationPlanSHA256.const = "9".repeat(64); },
    (x) => { x.oneOf.push({ $ref: "#/$defs/pass" }); },
    (x) => { x.$defs.currentPlanStop.allOf[1].properties.checks.properties.planCollectionReady.const = true; },
    (x) => { x.$defs.hostFactUnavailable.allOf[1].properties.checks.properties.planCollectionReady.const = false; },
    (x) => { x.$defs.hostFactUnavailable.allOf[1].properties.checks.properties.acPower.const = true; },
    (x) => { x.$defs.checkedStop.allOf[2].oneOf.pop(); },
    (x) => { x.$defs.checkedStop.allOf[2].oneOf[6].properties.checks.properties.candidateArtifactsMatch.const = false; },
    (x) => { x.$defs.checkedStop.allOf[2].oneOf[6].properties.stopReason.const = "display-fixture-mismatch"; },
    (x) => { x.$defs.pass.allOf[1].properties.checks.properties.acPower.const = false; },
    (x) => { x.$defs.pass.allOf[1].properties.stopReason.type = "string"; },
    (x) => { x.trackerCredit = 1; },
  ];
  for (const tamper of schemaTamperCases) {
    const value = structuredClone(schema);
    tamper(value);
    assert.throws(() => validateSchemaContract(value));
  }

  const sourceTamperCases = [
    (x) => x.replace("if (argc != 1)", "if (argc < 1)"),
    (x) => x.replace("provider(&error)", "provider(&error); provider(&error)"),
    (x) => `${x}\nIORegistry`,
    (x) => `${x}\nsystem_profiler`,
    (x) => x.replace(expectedPlanSHA256, "9".repeat(64)),
  ];
  for (const tamper of sourceTamperCases) assert.throws(() => validateSourceContract(tamper(source)));

  return {
    positives: currentPositives.length + futurePositives.length + Object.keys(checkStopReasons).length,
    negatives: futurePositives.length + Object.keys(checkStopReasons).length + tamperCases.length + semanticTamperCases.length + unavailableTamperCases.length + rawTamperCases.length + schemaTamperCases.length + sourceTamperCases.length,
  };
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(Buffer.byteLength(input, "utf8") <= 8192, "preflight output exceeds 8192 bytes");
  }
  return input;
}

async function main() {
  const [schemaBytes, source, planBytes] = await Promise.all([
    readFile(schemaPath),
    readFile(sourcePath, "utf8"),
    readFile(planPath),
  ]);
  const schema = JSON.parse(schemaBytes);
  if (process.argv[2] === "--validate-output") {
    assert.equal(process.argv.length, 3, "--validate-output accepts no additional arguments");
    validateSchemaContract(schema);
    validateSourceContract(source);
    validateWireOutput(await readStdin());
    console.log("Static-wakeup automated preflight output valid; this is not collection authority or qualification evidence.");
    return;
  }
  assert.equal(process.argv.length, 2, "usage: validate_m4_static_wakeup_preflight.mjs [--validate-output]");
  const counts = runSelfTests(schema, schemaBytes, source, planBytes);
  console.log(`Static-wakeup automated preflight contract valid: ${counts.positives} positive and ${counts.negatives} fail-closed cases passed; current plan invokes zero host callbacks.`);
}

main().catch((error) => {
  console.error(`Static-wakeup automated preflight validation failed: ${error.message}`);
  process.exitCode = 1;
});
