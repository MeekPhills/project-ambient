#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "schemas/resource-budgets/v1/static-wakeup-qualification.schema.json");
const planPath = path.join(root, "fixtures/resource-budgets/v1/base-m4-static-wakeup-qualification-plan.json");
const resourceFixturePath = path.join(root, "fixtures/resource-budgets/v1/base-m4-mac-mini.json");
const sha256Pattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const expectedSchemaSHA256 = "22fe9c9f2460760d4a97e6b77ca255b702323e036590b2a668ef2b6c9391fb98";
const expectedPlanSHA256 = "c071f4cd6032d4d961853df8aa3820365d31dd5c369c19edcd56e182d58c0069";

const expectedBinding = {
  fixtureId: "base-2024-m4-mac-mini-16gb-256gb",
  path: "fixtures/resource-budgets/v1/base-m4-mac-mini.json",
  revision: "1d089dd4ee315d4750773389b7499810764aa4d2",
  sha256: "b2adbdac201b42d70d77a7734fcb71c3e278684fc0c7903619868a98e837c54b",
};
const expectedProtocol = {
  repeatCount: 5,
  freshProcessInstancePerTrial: true,
  warmupSeconds: 300,
  measurementSeconds: 900,
  samplesPerWindow: 901,
  samplingIntervalSeconds: 1,
  deadlineMode: "absolute-monotonic",
  samplingGapSeconds: { minimum: 0.5, maximum: 2 },
  crossClockDriftMillisecondsMax: 100,
  acceptedElapsedSeconds: { minimum: 900, maximum: 905 },
  signpostsEnabled: false,
  diagnosticsEnabled: false,
  normalizationMinutes: 15,
  percentile: 95,
  percentileMethod: "nearest-rank",
  selectedRank: 5,
  wakeupsPerMinuteCeiling: 2,
  extraAttemptsAllowed: false,
  replacementAttemptsAllowed: false,
};
const expectedCandidateRequirements = {
  sameArtifactEveryTrial: true,
  cleanSourceRequired: true,
  sourceRevisionRequired: true,
  releaseManifestSHA256Required: true,
  macosArchiveSHA256Required: true,
  executableSHA256Required: true,
  architecture: "arm64",
  buildConfiguration: "release",
  allowedArtifactKinds: ["unsigned-candidate", "signed-notarized-candidate"],
  prohibitedArgument: "--wakeup-attribution-signposts",
};
const expectedMachineFixture = {
  model: "Mac mini (2024)",
  operatingSystem: "macOS",
  operatingSystemVersionRequiredBeforeCollection: true,
  operatingSystemBuildRequiredBeforeCollection: true,
  chip: "Apple M4",
  cpuCores: 10,
  gpuCores: 10,
  memoryGiB: 16,
  storageGiB: 256,
  acPower: true,
  lowPowerMode: false,
  thermalState: "nominal",
  hdr: "off",
  displays: [
    { logicalResolution: "3008x1692", refreshHz: 240, hiDPI: true, awake: true, mirrored: false },
    { logicalResolution: "2560x1440", refreshHz: 60, hiDPI: true, awake: true, mirrored: false },
  ],
};
const expectedScenario = {
  mode: "static",
  powerPolicy: "minimal",
  playbackStatus: "playing",
  rotationTrigger: "screen-lock",
  mediaType: "image",
  mediaDynamicRange: "sdr",
  fixedNonPersonalStillSHA256: null,
  fixedStillRequiredBeforeCollection: true,
  rulesEnabled: false,
  temporaryChannelActive: false,
  timedPauseActive: false,
  transitionInFlight: false,
  importOrScanInFlight: false,
  mainWindowVisible: false,
  settingsWindowVisible: false,
  importSheetVisible: false,
  menuBarPopoverVisible: false,
  userSessionUnlocked: true,
  interactionAllowed: false,
  competingControllerAllowed: false,
};
const expectedOwnerAttestations = [
  "factory-base-machine-configuration",
  "hdr-off",
  "fixed-still-applied-to-both-displays",
  "ambient-windows-hidden",
  "no-user-interaction-or-transition",
  "no-competing-controller-or-diagnostic",
];
const expectedProhibitedFields = [
  "pid", "processStartToken", "absoluteTimestamp", "path", "filename",
  "username", "hostUUID", "bootUUID", "hardwareSerial", "displayID",
  "displaySerial", "vendorID", "productID", "edid", "registryID",
  "environment", "logPayload",
];
const expectedProhibitedTools = [
  "private-apple-spi", "elevated-helper", "edid-or-ioregistry",
  "instruments-or-profiler", "system-trace", "unified-log-query-or-stream",
];
const topPlanKeys = [
  "schemaVersion", "contractId", "artifactKind", "claimScope",
  "resourceFixtureBinding", "protocol", "candidateRequirements",
  "machineFixture", "scenario", "attestationPolicy", "retentionPolicy",
  "collectionState",
];
const resultKeys = [
  "schemaVersion", "contractId", "artifactKind", "planRevision",
  "resourceFixtureBinding", "candidate", "fixtureMatch",
  "scenarioAttestation", "protocol", "windows", "aggregate", "coverage",
  "qualification",
];
const windowKeys = [
  "index", "snapshotCount", "elapsedSeconds", "interruptWakeups",
  "packageIdleWakeups", "normalizedWakeupsPerMinute",
  "freshProcessInstance", "warmupCompleted", "samplingGapSecondsMinimum",
  "samplingGapSecondsMaximum", "crossClockDriftMillisecondsMaximum",
  "processIdentityContinuous", "candidateIdentityContinuous",
  "fixtureStable", "scenarioStable", "eligible",
];
const fixtureMatchKeys = [
  "referenceMachine", "dualDisplay", "operatingSystemVersion",
  "operatingSystemBuild", "operatingSystemStableAcrossEveryTrial",
  "stableAcrossEveryTrial",
];
const scenarioAttestationKeys = [
  "fixedStillSHA256", "planScenarioMatched", "settledStatic",
  "windowsHidden", "signpostsDisabled", "diagnosticsDisabled",
  "noInteractionOrTransition", "noCompetingControllerOrDiagnostics",
  "complete",
];
const windowProofKeys = [
  "freshProcessInstance", "warmupCompleted", "processIdentityContinuous",
  "candidateIdentityContinuous", "fixtureStable", "scenarioStable", "eligible",
];
const aggregateKeys = [
  "acceptedWindowCount", "medianWakeupsPerMinute",
  "rangeWakeupsPerMinute", "p95WakeupsPerMinute",
  "contractConformance", "reason",
];
const schemaDefinitionKeys = [
  "sha256", "revision", "resourceFixtureBinding", "range", "protocol",
  "candidateRequirements", "display", "machineFixture", "scenario",
  "attestationPolicy", "retentionPolicy", "planCollectionState", "plan",
  "candidate", "fixtureMatch", "scenarioAttestation", "window",
  "resultBase", "incompleteResult", "completeResult",
];

function exactKeys(value, keys, at) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${at} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${at} has unexpected or missing keys`);
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= 1e-12;
}

function validatePlan(plan, resourceFixtureBytes, resourceFixture) {
  exactKeys(plan, topPlanKeys, "plan");
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.contractId, "base-m4-static-settled-hidden-wakeups-v1");
  assert.equal(plan.artifactKind, "qualification-plan");
  assert.equal(plan.claimScope, "protocol-only");
  assert.deepEqual(plan.resourceFixtureBinding, expectedBinding, "resource fixture binding drifted");
  assert.equal(createHash("sha256").update(resourceFixtureBytes).digest("hex"), expectedBinding.sha256, "bound resource fixture digest drifted");
  assert.equal(resourceFixture.fixtureId, expectedBinding.fixtureId, "bound resource fixture ID drifted");
  assert.equal(resourceFixture.budgets?.staticSettled?.wakeupsPerMinuteMax, 2, "bound wakeup ceiling drifted");
  assert.deepEqual(resourceFixture.displayFixture?.displays, [
    { logicalResolution: "3008x1692", refreshHz: 240 },
    { logicalResolution: "2560x1440", refreshHz: 60 },
  ], "bound display fixture drifted");
  assert.deepEqual(plan.protocol, expectedProtocol, "qualification protocol drifted");
  assert.deepEqual(plan.candidateRequirements, expectedCandidateRequirements, "candidate requirements drifted");
  assert.deepEqual(plan.machineFixture, expectedMachineFixture, "machine fixture drifted");
  assert.deepEqual(plan.scenario, expectedScenario, "plan must not claim a fixed still or collected scenario");
  assert.deepEqual(plan.attestationPolicy, {
    ownerRequiredFor: expectedOwnerAttestations,
    automatedMismatchOverridesOwner: true,
    missingAutomatedCheckStopsCollection: true,
  }, "attestation policy drifted");
  assert.deepEqual(plan.retentionPolicy, {
    rawRows: "temporary-auto-delete",
    retainedArtifact: "closed-sanitized-aggregates-only",
    prohibitedFields: expectedProhibitedFields,
    prohibitedTools: expectedProhibitedTools,
  }, "retention policy drifted");
  assert.deepEqual(plan.collectionState, {
    candidate: null,
    windows: [],
    aggregate: {
      acceptedWindowCount: 0,
      medianWakeupsPerMinute: null,
      rangeWakeupsPerMinute: null,
      p95WakeupsPerMinute: null,
      contractConformance: null,
      reason: "not-collected",
    },
    coverage: { scenarioWakeups: "unmeasured", globalWakeups: "unmeasured" },
    qualification: "plan-only",
  }, "plan must remain uncollected and unmeasured");
}

function validateSchemaContract(schema) {
  exactKeys(schema, ["$schema", "$id", "title", "oneOf", "$defs"], "schema");
  exactKeys(schema.$defs, schemaDefinitionKeys, "schema.$defs");
  assert.deepEqual(schema.oneOf, [
    { $ref: "#/$defs/plan" },
    { $ref: "#/$defs/incompleteResult" },
    { $ref: "#/$defs/completeResult" },
  ], "schema must keep plan, incomplete-result, and complete-result branches");
  assert.equal(schema.$defs.sha256.pattern, "^(?!0{64}$)[a-f0-9]{64}$");
  assert.equal(schema.$defs.revision.pattern, "^(?!0{40}$)[a-f0-9]{40}$");
  for (const name of [
    "resourceFixtureBinding", "range", "protocol", "candidateRequirements",
    "display", "machineFixture", "scenario", "attestationPolicy",
    "retentionPolicy", "planCollectionState", "plan", "candidate",
    "fixtureMatch", "scenarioAttestation", "window", "resultBase",
  ]) {
    assert.equal(schema.$defs?.[name]?.additionalProperties, false, `schema definition ${name} must be closed`);
  }
  assert.deepEqual([...schema.$defs.plan.required].sort(), [...topPlanKeys].sort());
  exactKeys(schema.$defs.plan.properties, topPlanKeys, "schema.$defs.plan.properties");
  assert.deepEqual([...schema.$defs.resultBase.required].sort(), [...resultKeys].sort());
  exactKeys(schema.$defs.resultBase.properties, resultKeys, "schema.$defs.resultBase.properties");
  for (const [name, keys] of [
    ["protocol", Object.keys(expectedProtocol)],
    ["candidateRequirements", Object.keys(expectedCandidateRequirements)],
    ["machineFixture", Object.keys(expectedMachineFixture)],
    ["scenario", Object.keys(expectedScenario)],
    ["fixtureMatch", fixtureMatchKeys],
    ["scenarioAttestation", scenarioAttestationKeys],
    ["window", windowKeys],
  ]) {
    assert.deepEqual([...schema.$defs[name].required].sort(), [...keys].sort(), `schema.$defs.${name}.required drifted`);
    exactKeys(schema.$defs[name].properties, keys, `schema.$defs.${name}.properties`);
  }
  assert.equal(schema.$defs.resourceFixtureBinding.properties.sha256.const, expectedBinding.sha256);
  assert.equal(schema.$defs.protocol.properties.repeatCount.const, 5);
  assert.equal(schema.$defs.protocol.properties.warmupSeconds.const, 300);
  assert.equal(schema.$defs.protocol.properties.measurementSeconds.const, 900);
  assert.equal(schema.$defs.protocol.properties.samplesPerWindow.const, 901);
  assert.equal(schema.$defs.protocol.properties.signpostsEnabled.const, false);
  assert.equal(schema.$defs.protocol.properties.diagnosticsEnabled.const, false);
  assert.equal(schema.$defs.protocol.properties.selectedRank.const, 5);
  assert.equal(schema.$defs.protocol.properties.wakeupsPerMinuteCeiling.const, 2);
  assert.equal(schema.$defs.protocol.properties.samplingGapSeconds.allOf[1].type, "object");
  assert.equal(schema.$defs.protocol.properties.acceptedElapsedSeconds.allOf[1].type, "object");
  assert.equal(schema.$defs.machineFixture.properties.displays.minItems, 2);
  assert.equal(schema.$defs.machineFixture.properties.displays.maxItems, 2);
  assert.ok(schema.$defs.machineFixture.properties.displays.prefixItems.every((entry) => entry.allOf[1].type === "object"));
  assert.equal(schema.$defs.scenario.properties.fixedNonPersonalStillSHA256.type, "null");
  assert.deepEqual(schema.$defs.retentionPolicy.properties.prohibitedFields.const, expectedProhibitedFields);
  assert.deepEqual(schema.$defs.retentionPolicy.properties.prohibitedTools.const, expectedProhibitedTools);
  for (const name of ["incompleteResult", "completeResult"]) {
    exactKeys(schema.$defs[name], ["allOf"], `schema.$defs.${name}`);
    assert.equal(schema.$defs[name].allOf.length, 2);
    assert.deepEqual(schema.$defs[name].allOf[0], { $ref: "#/$defs/resultBase" });
    const branch = schema.$defs[name].allOf[1];
    assert.equal(branch.type, "object");
    assert.equal(branch.additionalProperties, false);
    exactKeys(branch.properties, resultKeys, `schema.$defs.${name}.properties`);
    assert.equal(branch.properties.aggregate.additionalProperties, false);
    assert.equal(branch.properties.coverage.additionalProperties, false);
  }
  assert.equal(schema.$defs.completeResult.allOf[1].properties.windows.minItems, 5);
  assert.equal(schema.$defs.completeResult.allOf[1].properties.windows.maxItems, 5);
  assert.equal(schema.$defs.window.properties.samplingGapSecondsMinimum.minimum, 0.5);
  assert.equal(schema.$defs.window.properties.samplingGapSecondsMaximum.maximum, 2);
  assert.equal(schema.$defs.window.properties.crossClockDriftMillisecondsMaximum.maximum, 100);
  const completeFixtureSchema = schema.$defs.completeResult.allOf[1].properties.fixtureMatch;
  assert.deepEqual(completeFixtureSchema.allOf[0], { $ref: "#/$defs/fixtureMatch" });
  for (const key of ["referenceMachine", "dualDisplay", "operatingSystemStableAcrossEveryTrial", "stableAcrossEveryTrial"]) {
    assert.equal(completeFixtureSchema.allOf[1].properties[key].const, true);
  }
  const completeScenarioSchema = schema.$defs.completeResult.allOf[1].properties.scenarioAttestation;
  assert.deepEqual(completeScenarioSchema.allOf[0], { $ref: "#/$defs/scenarioAttestation" });
  for (const key of scenarioAttestationKeys.filter((key) => key !== "fixedStillSHA256")) {
    assert.equal(completeScenarioSchema.allOf[1].properties[key].const, true);
  }
  const completeWindowSchema = schema.$defs.completeResult.allOf[1].properties.windows.items;
  assert.deepEqual(completeWindowSchema.allOf[0], { $ref: "#/$defs/window" });
  for (const key of windowProofKeys) assert.equal(completeWindowSchema.allOf[1].properties[key].const, true);
  assert.equal(schema.$defs.completeResult.allOf[1].properties.coverage.properties.globalWakeups.const, "partial");
  assert.equal(schema.$defs.incompleteResult.allOf[1].properties.aggregate.properties.contractConformance.type, "null");
  assert.equal(JSON.stringify(schema).includes("trackerCredit"), false, "qualification schema must not carry tracker credit");
}

function validateCandidate(candidate) {
  exactKeys(candidate, [
    "sourceRevision", "version", "releaseManifestSHA256", "macosArchiveSHA256",
    "executableSHA256", "architecture", "buildConfiguration", "artifactKind",
    "cleanSource",
  ], "result.candidate");
  assert.match(candidate.sourceRevision, revisionPattern);
  assert.notEqual(candidate.sourceRevision, "0".repeat(40));
  assert.match(candidate.version, /^[0-9]+[.][0-9]+[.][0-9]+$/);
  for (const key of ["releaseManifestSHA256", "macosArchiveSHA256", "executableSHA256"]) {
    assert.match(candidate[key], sha256Pattern, `${key} must be a SHA-256 digest`);
    assert.notEqual(candidate[key], "0".repeat(64), `${key} cannot be a placeholder`);
  }
  assert.equal(candidate.architecture, "arm64");
  assert.equal(candidate.buildConfiguration, "release");
  assert.ok(["unsigned-candidate", "signed-notarized-candidate"].includes(candidate.artifactKind));
  assert.equal(candidate.cleanSource, true);
}

function validateWindow(window, expectedIndex) {
  exactKeys(window, windowKeys, `result.windows[${expectedIndex - 1}]`);
  assert.equal(window.index, expectedIndex, "trial indices must be exact and ordered");
  assert.equal(window.snapshotCount, 901);
  assert.ok(Number.isFinite(window.elapsedSeconds) && window.elapsedSeconds >= 900 && window.elapsedSeconds <= 905);
  assert.ok(Number.isSafeInteger(window.interruptWakeups) && window.interruptWakeups >= 0);
  assert.ok(Number.isSafeInteger(window.packageIdleWakeups) && window.packageIdleWakeups >= 0);
  assert.ok(window.packageIdleWakeups <= window.interruptWakeups, "package-idle wakeups must remain a subset");
  assert.ok(Number.isFinite(window.normalizedWakeupsPerMinute) && window.normalizedWakeupsPerMinute >= 0);
  assert.ok(approximatelyEqual(window.normalizedWakeupsPerMinute, window.interruptWakeups / 15), "window rate must use fixed fifteen-minute normalization");
  assert.ok(Number.isFinite(window.samplingGapSecondsMinimum) && window.samplingGapSecondsMinimum >= 0.5);
  assert.ok(Number.isFinite(window.samplingGapSecondsMaximum) && window.samplingGapSecondsMaximum <= 2);
  assert.ok(window.samplingGapSecondsMinimum <= window.samplingGapSecondsMaximum, "sampling-gap bounds are inverted");
  const averageSamplingGap = window.elapsedSeconds / (window.snapshotCount - 1);
  assert.ok(averageSamplingGap >= window.samplingGapSecondsMinimum - 1e-9, "average sampling gap is below the retained minimum");
  assert.ok(averageSamplingGap <= window.samplingGapSecondsMaximum + 1e-9, "average sampling gap exceeds the retained maximum");
  assert.ok(Number.isFinite(window.crossClockDriftMillisecondsMaximum));
  assert.ok(window.crossClockDriftMillisecondsMaximum >= 0 && window.crossClockDriftMillisecondsMaximum <= 100);
  for (const key of windowProofKeys) {
    assert.equal(typeof window[key], "boolean", `${key} must be boolean`);
  }
  if (window.eligible) {
    for (const key of windowProofKeys.filter((key) => key !== "eligible")) {
      assert.equal(window[key], true, `eligible trial requires ${key}`);
    }
  }
}

function assertNoRetainedIdentifiers(value, at = "result") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRetainedIdentifiers(entry, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const resourcePath = at === "result.resourceFixtureBinding" && key === "path";
    assert.ok(resourcePath || !expectedProhibitedFields.includes(key), `${at} retains prohibited field ${key}`);
    assertNoRetainedIdentifiers(child, `${at}.${key}`);
  }
}

function validateResult(result) {
  exactKeys(result, resultKeys, "result");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.contractId, "base-m4-static-settled-hidden-wakeups-v1");
  assert.equal(result.artifactKind, "qualification-result");
  assert.match(result.planRevision, revisionPattern);
  assert.notEqual(result.planRevision, "0".repeat(40));
  assert.deepEqual(result.resourceFixtureBinding, expectedBinding);
  validateCandidate(result.candidate);
  exactKeys(result.fixtureMatch, fixtureMatchKeys, "result.fixtureMatch");
  for (const key of ["referenceMachine", "dualDisplay", "operatingSystemStableAcrossEveryTrial", "stableAcrossEveryTrial"]) {
    assert.equal(typeof result.fixtureMatch[key], "boolean", `result.fixtureMatch.${key} must be boolean`);
  }
  assert.match(result.fixtureMatch.operatingSystemVersion, /^[0-9]+(?:[.][0-9]+){1,2}$/);
  assert.match(result.fixtureMatch.operatingSystemBuild, /^[A-Za-z0-9]+$/);
  exactKeys(result.scenarioAttestation, scenarioAttestationKeys, "result.scenarioAttestation");
  assert.match(result.scenarioAttestation.fixedStillSHA256, sha256Pattern);
  assert.notEqual(result.scenarioAttestation.fixedStillSHA256, "0".repeat(64));
  for (const key of scenarioAttestationKeys.filter((key) => key !== "fixedStillSHA256")) {
    assert.equal(typeof result.scenarioAttestation[key], "boolean", `result.scenarioAttestation.${key} must be boolean`);
  }
  assert.deepEqual(result.protocol, expectedProtocol);
  assert.ok(Array.isArray(result.windows) && result.windows.length <= 5);
  result.windows.forEach((window, index) => validateWindow(window, index + 1));
  exactKeys(result.aggregate, aggregateKeys, "result.aggregate");
  exactKeys(result.coverage, ["scenarioWakeups", "globalWakeups"], "result.coverage");
  assertNoRetainedIdentifiers(result);

  const accepted = result.windows.filter((window) => window.eligible).length;
  if (result.qualification === "incomplete") {
    assert.ok(accepted <= 4, "incomplete results cannot contain five eligible trials");
    assert.equal(result.aggregate.acceptedWindowCount, accepted);
    for (const key of ["medianWakeupsPerMinute", "rangeWakeupsPerMinute", "p95WakeupsPerMinute", "contractConformance"]) {
      assert.equal(result.aggregate[key], null, `incomplete result must keep ${key} null`);
    }
    assert.ok(["incomplete-trial-set", "automated-mismatch", "missing-attestation", "candidate-or-fixture-drift"].includes(result.aggregate.reason));
    assert.equal(result.coverage.scenarioWakeups, accepted === 0 ? "unmeasured" : "partial");
    assert.equal(result.coverage.globalWakeups, "unmeasured");
    return;
  }

  assert.ok(["scenario-pass", "scenario-fail"].includes(result.qualification));
  assert.equal(result.windows.length, 5);
  assert.equal(accepted, 5);
  assert.ok(result.windows.every((window) => windowProofKeys.every((key) => window[key])));
  assert.equal(result.fixtureMatch.referenceMachine, true);
  assert.equal(result.fixtureMatch.dualDisplay, true);
  assert.equal(result.fixtureMatch.operatingSystemStableAcrossEveryTrial, true);
  assert.equal(result.fixtureMatch.stableAcrossEveryTrial, true);
  assert.deepEqual(result.scenarioAttestation, {
    fixedStillSHA256: result.scenarioAttestation.fixedStillSHA256,
    planScenarioMatched: true,
    settledStatic: true,
    windowsHidden: true,
    signpostsDisabled: true,
    diagnosticsDisabled: true,
    noInteractionOrTransition: true,
    noCompetingControllerOrDiagnostics: true,
    complete: true,
  });
  const rates = result.windows.map((window) => window.normalizedWakeupsPerMinute).sort((left, right) => left - right);
  const median = rates[2];
  const minimum = rates[0];
  const maximum = rates[4];
  assert.equal(result.aggregate.acceptedWindowCount, 5);
  assert.ok(approximatelyEqual(result.aggregate.medianWakeupsPerMinute, median));
  exactKeys(result.aggregate.rangeWakeupsPerMinute, ["minimum", "maximum"], "result.aggregate.rangeWakeupsPerMinute");
  assert.ok(approximatelyEqual(result.aggregate.rangeWakeupsPerMinute.minimum, minimum));
  assert.ok(approximatelyEqual(result.aggregate.rangeWakeupsPerMinute.maximum, maximum));
  assert.ok(approximatelyEqual(result.aggregate.p95WakeupsPerMinute, maximum), "nearest-rank P95 must select rank five");
  const conforms = maximum <= 2;
  assert.equal(result.aggregate.contractConformance, conforms);
  assert.equal(result.aggregate.reason, null);
  assert.equal(result.qualification, conforms ? "scenario-pass" : "scenario-fail");
  assert.deepEqual(result.coverage, { scenarioWakeups: "measured", globalWakeups: "partial" });
}

function makeResult(wakeups = [0, 5, 10, 15, 30]) {
  const windows = wakeups.map((interruptWakeups, index) => ({
    index: index + 1,
    snapshotCount: 901,
    elapsedSeconds: 900 + index,
    interruptWakeups,
    packageIdleWakeups: 0,
    normalizedWakeupsPerMinute: interruptWakeups / 15,
    freshProcessInstance: true,
    warmupCompleted: true,
    samplingGapSecondsMinimum: 0.99,
    samplingGapSecondsMaximum: 1.01,
    crossClockDriftMillisecondsMaximum: 10,
    processIdentityContinuous: true,
    candidateIdentityContinuous: true,
    fixtureStable: true,
    scenarioStable: true,
    eligible: true,
  }));
  const rates = windows.map((window) => window.normalizedWakeupsPerMinute).sort((left, right) => left - right);
  const p95 = rates[4];
  return {
    schemaVersion: 1,
    contractId: "base-m4-static-settled-hidden-wakeups-v1",
    artifactKind: "qualification-result",
    planRevision: "a".repeat(40),
    resourceFixtureBinding: structuredClone(expectedBinding),
    candidate: {
      sourceRevision: "b".repeat(40),
      version: "0.1.0",
      releaseManifestSHA256: "1".repeat(64),
      macosArchiveSHA256: "2".repeat(64),
      executableSHA256: "3".repeat(64),
      architecture: "arm64",
      buildConfiguration: "release",
      artifactKind: "unsigned-candidate",
      cleanSource: true,
    },
    fixtureMatch: {
      referenceMachine: true,
      dualDisplay: true,
      operatingSystemVersion: "15.0",
      operatingSystemBuild: "24A1",
      operatingSystemStableAcrossEveryTrial: true,
      stableAcrossEveryTrial: true,
    },
    scenarioAttestation: {
      fixedStillSHA256: "4".repeat(64),
      planScenarioMatched: true,
      settledStatic: true,
      windowsHidden: true,
      signpostsDisabled: true,
      diagnosticsDisabled: true,
      noInteractionOrTransition: true,
      noCompetingControllerOrDiagnostics: true,
      complete: true,
    },
    protocol: structuredClone(expectedProtocol),
    windows,
    aggregate: {
      acceptedWindowCount: 5,
      medianWakeupsPerMinute: rates[2],
      rangeWakeupsPerMinute: { minimum: rates[0], maximum: rates[4] },
      p95WakeupsPerMinute: p95,
      contractConformance: p95 <= 2,
      reason: null,
    },
    coverage: { scenarioWakeups: "measured", globalWakeups: "partial" },
    qualification: p95 <= 2 ? "scenario-pass" : "scenario-fail",
  };
}

function makeIncomplete() {
  const result = makeResult();
  result.windows.pop();
  result.aggregate = {
    acceptedWindowCount: 4,
    medianWakeupsPerMinute: null,
    rangeWakeupsPerMinute: null,
    p95WakeupsPerMinute: null,
    contractConformance: null,
    reason: "incomplete-trial-set",
  };
  result.coverage = { scenarioWakeups: "partial", globalWakeups: "unmeasured" };
  result.qualification = "incomplete";
  return result;
}

function runSelfTests(plan, schema, schemaBytes, planBytes, resourceFixtureBytes, resourceFixture) {
  assert.equal(createHash("sha256").update(schemaBytes).digest("hex"), expectedSchemaSHA256, "qualification schema bytes drifted");
  assert.equal(createHash("sha256").update(planBytes).digest("hex"), expectedPlanSHA256, "qualification plan bytes drifted");
  validateSchemaContract(schema);
  validatePlan(plan, resourceFixtureBytes, resourceFixture);
  validateResult(makeResult());
  validateResult(makeResult([0, 5, 10, 15, 31]));
  validateResult(makeIncomplete());

  const planTamperCases = [
    (x) => { delete x.protocol.repeatCount; },
    (x) => { x.trackerCredit = 1; },
    (x) => { x.resourceFixtureBinding.sha256 = "f".repeat(64); },
    (x) => { x.protocol.repeatCount = 4; },
    (x) => { x.protocol.freshProcessInstancePerTrial = false; },
    (x) => { x.protocol.warmupSeconds = 299; },
    (x) => { x.protocol.measurementSeconds = 899; },
    (x) => { x.protocol.samplesPerWindow = 900; },
    (x) => { x.protocol.deadlineMode = "relative-sleep"; },
    (x) => { x.protocol.samplingGapSeconds.maximum = 3; },
    (x) => { x.protocol.crossClockDriftMillisecondsMax = 101; },
    (x) => { x.protocol.signpostsEnabled = true; },
    (x) => { x.protocol.diagnosticsEnabled = true; },
    (x) => { x.protocol.normalizationMinutes = 15.1; },
    (x) => { x.protocol.percentileMethod = "interpolated"; },
    (x) => { x.protocol.selectedRank = 4; },
    (x) => { x.protocol.wakeupsPerMinuteCeiling = 3; },
    (x) => { x.protocol.extraAttemptsAllowed = true; },
    (x) => { x.protocol.replacementAttemptsAllowed = true; },
    (x) => { x.machineFixture.memoryGiB = 32; },
    (x) => { x.machineFixture.operatingSystemBuildRequiredBeforeCollection = false; },
    (x) => { x.machineFixture.displays.pop(); },
    (x) => { x.machineFixture.displays[0].refreshHz = 120; },
    (x) => { x.machineFixture.hdr = "unknown"; },
    (x) => { x.scenario.fixedNonPersonalStillSHA256 = "1".repeat(64); },
    (x) => { x.scenario.mainWindowVisible = true; },
    (x) => { x.attestationPolicy.automatedMismatchOverridesOwner = false; },
    (x) => { x.collectionState.candidate = {}; },
    (x) => { x.collectionState.coverage.scenarioWakeups = "measured"; },
  ];
  for (const tamper of planTamperCases) {
    const candidate = structuredClone(plan);
    tamper(candidate);
    assert.throws(() => validatePlan(candidate, resourceFixtureBytes, resourceFixture));
  }

  const resultTamperCases = [
    (x) => { x.windows.pop(); },
    (x) => { x.windows[1].index = 1; },
    (x) => { [x.windows[0], x.windows[1]] = [x.windows[1], x.windows[0]]; },
    (x) => { x.windows[0].snapshotCount = 900; },
    (x) => { x.windows[0].elapsedSeconds = 899; },
    (x) => { x.windows[0].packageIdleWakeups = x.windows[0].interruptWakeups + 1; },
    (x) => { x.windows[1].normalizedWakeupsPerMinute = x.windows[1].interruptWakeups / x.windows[1].elapsedSeconds * 60; },
    (x) => { x.windows[0].samplingGapSecondsMinimum = 0.4; },
    (x) => { x.windows[0].samplingGapSecondsMaximum = 3; },
    (x) => { x.windows[0].samplingGapSecondsMinimum = 1.5; },
    (x) => { x.windows[0].crossClockDriftMillisecondsMaximum = 101; },
    (x) => { x.windows[0].freshProcessInstance = false; },
    (x) => { x.windows[0].warmupCompleted = false; },
    (x) => { x.windows[0].processIdentityContinuous = false; },
    (x) => { x.windows[0].scenarioStable = false; },
    (x) => { x.fixtureMatch.dualDisplay = false; },
    (x) => { x.fixtureMatch.operatingSystemVersion = "unknown"; },
    (x) => { x.fixtureMatch.operatingSystemStableAcrossEveryTrial = false; },
    (x) => { x.scenarioAttestation.planScenarioMatched = false; },
    (x) => { x.scenarioAttestation.signpostsDisabled = false; },
    (x) => { x.scenarioAttestation.windowsHidden = false; },
    (x) => { x.candidate.architecture = "x86_64"; },
    (x) => { x.candidate.executableSHA256 = "0".repeat(64); },
    (x) => { x.aggregate.medianWakeupsPerMinute += 1; },
    (x) => { x.aggregate.rangeWakeupsPerMinute.maximum -= 1; },
    (x) => { x.aggregate.p95WakeupsPerMinute = x.aggregate.medianWakeupsPerMinute; },
    (x) => { x.aggregate.contractConformance = false; },
    (x) => { x.qualification = "scenario-fail"; },
    (x) => { x.coverage.globalWakeups = "measured"; },
    (x) => { x.pid = 1; },
  ];
  for (const tamper of resultTamperCases) {
    const candidate = makeResult();
    tamper(candidate);
    assert.throws(() => validateResult(candidate));
  }

  const incompleteTamperCases = [
    (x) => { x.fixtureMatch.referenceMachine = "unknown"; },
    (x) => { x.scenarioAttestation.complete = "false"; },
    (x) => { x.windows[0].freshProcessInstance = false; },
    (x) => {
      x.windows = [];
      x.aggregate.acceptedWindowCount = 0;
      x.coverage.scenarioWakeups = "partial";
    },
  ];
  for (const tamper of incompleteTamperCases) {
    const candidate = makeIncomplete();
    tamper(candidate);
    assert.throws(() => validateResult(candidate));
  }

  const schemaTamperCases = [
    (x) => { x.$defs.plan.additionalProperties = true; },
    (x) => { x.$defs.range.additionalProperties = true; },
    (x) => { x.$defs.protocol.properties.repeatCount.const = 4; },
    (x) => { x.$defs.protocol.properties.wakeupsPerMinuteCeiling.const = 3; },
    (x) => { delete x.$defs.protocol.properties.samplingGapSeconds.allOf[1].type; },
    (x) => { x.$defs.scenario.properties.fixedNonPersonalStillSHA256 = { $ref: "#/$defs/sha256" }; },
    (x) => { x.$defs.retentionPolicy.properties.prohibitedFields.const.pop(); },
    (x) => { x.$defs.resultBase.required.pop(); },
    (x) => { x.$defs.completeResult.allOf[1].additionalProperties = true; },
    (x) => { x.$defs.window.properties.samplingGapSecondsMaximum.maximum = 3; },
    (x) => { x.$defs.completeResult.allOf[1].properties.windows.items.allOf[1].properties.eligible.const = false; },
    (x) => { x.$defs.completeResult.allOf[1].properties.scenarioAttestation.allOf[1].properties.signpostsDisabled.const = false; },
    (x) => { x.$defs.completeResult.allOf[1].properties.windows.maxItems = 6; },
    (x) => { x.$defs.completeResult.allOf[1].properties.coverage.properties.globalWakeups.const = "measured"; },
    (x) => { x.trackerCredit = 1; },
  ];
  for (const tamper of schemaTamperCases) {
    const candidate = structuredClone(schema);
    tamper(candidate);
    assert.throws(() => validateSchemaContract(candidate));
  }
  return {
    positives: 4,
    negatives: planTamperCases.length + resultTamperCases.length + incompleteTamperCases.length + schemaTamperCases.length,
  };
}

async function main() {
  assert.equal(process.argv.length, 2, "usage: validate_m4_static_wakeup_qualification.mjs");
  const [schemaBytes, planBytes, resourceFixtureBytes] = await Promise.all([
    readFile(schemaPath),
    readFile(planPath),
    readFile(resourceFixturePath),
  ]);
  const schema = JSON.parse(schemaBytes);
  const plan = JSON.parse(planBytes);
  const resourceFixture = JSON.parse(resourceFixtureBytes);
  const counts = runSelfTests(plan, schema, schemaBytes, planBytes, resourceFixtureBytes, resourceFixture);
  console.log(`Static-wakeup qualification contract valid: plan only, ${counts.positives} positive and ${counts.negatives} fail-closed cases passed; no host evidence collected.`);
}

main().catch((error) => {
  console.error(`Static-wakeup qualification validation failed: ${error.message}`);
  process.exitCode = 1;
});
