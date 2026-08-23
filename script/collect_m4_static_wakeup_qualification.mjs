#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeProcessRusageSeries } from "./summarize_process_rusage_series.mjs";
import {
  expectedPlanRevision,
  makePlanBinding,
  validatePlan,
  validateResult as validateQualificationResult,
} from "./validate_m4_static_wakeup_qualification.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planPath = path.join(root, "fixtures/resource-budgets/v1/base-m4-static-wakeup-qualification-plan.json");
const resourceFixturePath = path.join(root, "fixtures/resource-budgets/v1/base-m4-mac-mini.json");
const qualificationSchemaPath = path.join(root, "schemas/resource-budgets/v1/static-wakeup-qualification.schema.json");

const nanosecondsPerSecond = 1_000_000_000n;
const microsecondsPerSecond = 1_000_000n;
const maxUInt64 = (1n << 64n) - 1n;
const maxClockDriftNanoseconds = 100_000_000n;
const syntheticTestToken = Symbol("ambient-static-wakeup-collector-synthetic-test");
const preflightProducerRevision = "b439193ed513811bec90ce2491ec30033aa2a4e4";
const fixedStillSHA256 = "4".repeat(64);

const ownerAttestationNames = [
  "factory-base-machine-configuration",
  "hdr-off",
  "fixed-still-applied-to-both-displays",
  "ambient-windows-hidden",
  "no-user-interaction-or-transition",
  "no-competing-controller-or-diagnostic",
];
const preflightCheckKeys = [
  "planCollectionReady",
  "candidateArtifactsMatch",
  "runningExecutableMatches",
  "nativeArm64",
  "prohibitedArgumentsAbsent",
  "freshProcessIdentity",
  "publicMachineFactsMatch",
  "acPower",
  "lowPowerModeOff",
  "thermalNominal",
  "persistedAmbientSubsetMatches",
  "displayFixtureMatches",
];
const preflightResultKeys = [
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
const fixtureObservationKeys = [
  "referenceMachine", "dualDisplay", "operatingSystemVersion",
  "operatingSystemBuild",
];
const scenarioObservationKeys = [
  "fixedStillSHA256", "planScenarioMatched", "settledStatic",
  "windowsHidden", "signpostsDisabled", "diagnosticsDisabled",
  "noInteractionOrTransition", "noCompetingControllerOrDiagnostics",
];
const observationKeys = [
  "monotonicNanoseconds", "wallClockUnixMicroseconds", "processIdentity",
  "candidate", "fixture", "scenario", "fixtureContinuityObserved",
  "scenarioContinuityObserved",
];
const sessionKeys = [
  "launchReceipt", "launchObservation", "waitUntilAbsolute",
  "sampleAtAbsoluteDeadline", "finishTrial",
];

function exactKeys(value, keys, at) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${at} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${at} has unexpected or missing keys`);
}

function parseCanonicalUInt64(value, at) {
  assert.equal(typeof value, "string", `${at} must be a canonical decimal uint64 string`);
  assert.match(value, /^(0|[1-9][0-9]*)$/, `${at} must be a canonical decimal uint64 string`);
  const parsed = BigInt(value);
  assert.ok(parsed <= maxUInt64, `${at} exceeds uint64`);
  return parsed;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stopped(reason, attemptedTrials = 0) {
  return { status: "stop", reason, attemptedTrials, result: null };
}

function absolute(value) {
  return value < 0n ? -value : value;
}

function validatePairedClockProgress(before, after, at) {
  const beforeMonotonic = parseCanonicalUInt64(before.monotonicNanoseconds, `${at}.before.monotonicNanoseconds`);
  const afterMonotonic = parseCanonicalUInt64(after.monotonicNanoseconds, `${at}.after.monotonicNanoseconds`);
  const beforeWall = parseCanonicalUInt64(before.wallClockUnixMicroseconds, `${at}.before.wallClockUnixMicroseconds`);
  const afterWall = parseCanonicalUInt64(after.wallClockUnixMicroseconds, `${at}.after.wallClockUnixMicroseconds`);
  assert.ok(afterMonotonic >= beforeMonotonic, `${at} monotonic clock regressed`);
  assert.ok(afterWall >= beforeWall, `${at} wall clock regressed`);
  const monotonicDelta = afterMonotonic - beforeMonotonic;
  const wallDeltaNanoseconds = (afterWall - beforeWall) * 1000n;
  const absoluteDriftNanoseconds = absolute(wallDeltaNanoseconds - monotonicDelta);
  assert.ok(
    absoluteDriftNanoseconds <= maxClockDriftNanoseconds,
    `${at} paired clocks diverged by more than 100 ms`,
  );
  return { beforeMonotonic, afterMonotonic, beforeWall, afterWall, absoluteDriftNanoseconds };
}

export function buildAbsoluteDeadlines(originNanoseconds) {
  const origin = typeof originNanoseconds === "bigint"
    ? originNanoseconds
    : parseCanonicalUInt64(originNanoseconds, "measurement origin");
  const finalDeadline = origin + 900n * nanosecondsPerSecond;
  assert.ok(finalDeadline <= maxUInt64, "measurement deadlines exceed uint64");
  return Object.freeze(Array.from(
    { length: 901 },
    (_, index) => (origin + BigInt(index) * nanosecondsPerSecond).toString(),
  ));
}

function validateCandidate(candidate, at) {
  exactKeys(candidate, candidateKeys, at);
  assert.match(candidate.version, /^[0-9]{1,5}[.][0-9]{1,5}[.][0-9]{1,5}$/);
  assert.match(candidate.sourceRevision, /^(?!0{40}$)[a-f0-9]{40}$/);
  for (const key of ["releaseManifestSHA256", "macosArchiveSHA256", "executableSHA256"]) {
    assert.match(candidate[key], /^(?!0{64}$)[a-f0-9]{64}$/);
  }
  assert.equal(candidate.architecture, "arm64");
  assert.equal(candidate.buildConfiguration, "release");
  assert.ok(["unsigned-candidate", "signed-notarized-candidate"].includes(candidate.artifactKind));
  assert.equal(candidate.cleanSource, true);
}

function validateSyntheticPreflight(value, expectedQualificationPlanSHA256) {
  exactKeys(value, preflightResultKeys, "synthetic preflight");
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.contractId, "base-m4-static-settled-hidden-wakeups-preflight-v1");
  assert.equal(value.artifactKind, "automated-preflight-result");
  assert.equal(value.claimScope, "automated-preflight-only");
  assert.equal(value.producerRevision, preflightProducerRevision);
  assert.match(expectedQualificationPlanSHA256, /^(?!0{64}$)[a-f0-9]{64}$/);
  assert.equal(value.qualificationPlanSHA256, expectedQualificationPlanSHA256);
  assert.deepEqual(value.remainingOwnerAttestations, ownerAttestationNames);
  exactKeys(value.checks, preflightCheckKeys, "synthetic preflight.checks");
  for (const key of preflightCheckKeys) {
    assert.equal(typeof value.checks[key], "boolean", `synthetic preflight.checks.${key} must be boolean`);
  }

  if (value.candidate === null || value.operatingSystem === null) {
    assert.equal(value.candidate, null);
    assert.equal(value.operatingSystem, null);
    assert.equal(value.checks.planCollectionReady, true);
    assert.ok(preflightCheckKeys.slice(1).every((key) => value.checks[key] === false));
    assert.equal(value.status, "stop");
    assert.equal(value.stopReason, "public-fact-unavailable");
    return;
  }

  validateCandidate(value.candidate, "synthetic preflight.candidate");
  exactKeys(value.operatingSystem, ["version", "build"], "synthetic preflight.operatingSystem");
  assert.match(value.operatingSystem.version, /^[0-9]{1,2}(?:[.][0-9]{1,2}){1,2}$/);
  assert.match(value.operatingSystem.build, /^[0-9]{2}[A-Z][0-9]{1,4}[a-z]?$/);
  assert.ok(preflightCheckKeys.every((key) => value.checks[key]), "synthetic preflight pass requires every check");
  assert.equal(value.status, "pass");
  assert.equal(value.stopReason, null);
}

function validateOwnerAttestations(value, planBinding) {
  exactKeys(value, ["qualificationPlanSHA256", "statements"], "owner attestations");
  assert.equal(value.qualificationPlanSHA256, planBinding.sha256);
  exactKeys(value.statements, ownerAttestationNames, "owner attestations.statements");
  for (const name of ownerAttestationNames) {
    assert.equal(value.statements[name], true, `owner attestation ${name} must be explicitly true`);
  }
}

function validateProcessIdentity(identity, at) {
  exactKeys(identity, ["processStartAbsoluteTime", "processStartUnixMicroseconds"], at);
  const absoluteStart = parseCanonicalUInt64(identity.processStartAbsoluteTime, `${at}.processStartAbsoluteTime`);
  const wallStart = parseCanonicalUInt64(identity.processStartUnixMicroseconds, `${at}.processStartUnixMicroseconds`);
  assert.ok(absoluteStart > 0n, `${at} absolute process-start token must be positive`);
  assert.ok(wallStart > 0n, `${at} wall-clock process-start token must be positive`);
  return { key: `${identity.processStartAbsoluteTime}:${identity.processStartUnixMicroseconds}`, wallStart };
}

function validateFixtureObservation(value, preflight, at) {
  exactKeys(value, fixtureObservationKeys, at);
  assert.equal(value.referenceMachine, true, `${at}.referenceMachine must be true`);
  assert.equal(value.dualDisplay, true, `${at}.dualDisplay must be true`);
  assert.equal(value.operatingSystemVersion, preflight.operatingSystem.version, `${at} macOS version drifted`);
  assert.equal(value.operatingSystemBuild, preflight.operatingSystem.build, `${at} macOS build drifted`);
}

function validateScenarioObservation(value, planBinding, at) {
  exactKeys(value, scenarioObservationKeys, at);
  assert.equal(value.fixedStillSHA256, planBinding.plan.scenario.fixedNonPersonalStillSHA256, `${at} fixed still drifted`);
  for (const key of scenarioObservationKeys.filter((key) => key !== "fixedStillSHA256")) {
    assert.equal(value[key], true, `${at}.${key} must be true`);
  }
}

function validateObservation(observation, context, at) {
  exactKeys(observation, observationKeys, at);
  parseCanonicalUInt64(observation.monotonicNanoseconds, `${at}.monotonicNanoseconds`);
  parseCanonicalUInt64(observation.wallClockUnixMicroseconds, `${at}.wallClockUnixMicroseconds`);
  const identity = validateProcessIdentity(observation.processIdentity, `${at}.processIdentity`);
  assert.deepEqual(observation.candidate, context.preflight.candidate, `${at} candidate drifted`);
  validateFixtureObservation(observation.fixture, context.preflight, `${at}.fixture`);
  validateScenarioObservation(observation.scenario, context.planBinding, `${at}.scenario`);
  assert.equal(observation.fixtureContinuityObserved, true, `${at} fixture continuity must be observed`);
  assert.equal(observation.scenarioContinuityObserved, true, `${at} scenario continuity must be observed`);
  if (context.fixtureBaseline !== null) {
    assert.deepEqual(observation.fixture, context.fixtureBaseline, `${at} fixture changed between observations`);
  }
  if (context.scenarioBaseline !== null) {
    assert.deepEqual(observation.scenario, context.scenarioBaseline, `${at} scenario changed between observations`);
  }
  return identity;
}

function makeLaunchSpecification(index, planBinding, preflight) {
  return deepFreeze({
    index,
    warmupSeconds: planBinding.plan.protocol.warmupSeconds,
    measurementSeconds: planBinding.plan.protocol.measurementSeconds,
    samplesPerWindow: planBinding.plan.protocol.samplesPerWindow,
    samplingIntervalSeconds: planBinding.plan.protocol.samplingIntervalSeconds,
    deadlineMode: planBinding.plan.protocol.deadlineMode,
    candidate: structuredClone(preflight.candidate),
    operatingSystem: structuredClone(preflight.operatingSystem),
    fixedStillSHA256: planBinding.plan.scenario.fixedNonPersonalStillSHA256,
  });
}

function projectSanitizedWindow(index, snapshots, identity, context, collectorClockDriftNanosecondsMaximum) {
  const analysis = analyzeProcessRusageSeries(snapshots, 1, 901);
  const { summary, qualificationProof } = analysis;
  assert.equal(summary.processStartAbsoluteTime, identity.processStartAbsoluteTime);
  assert.equal(summary.processStartUnixMicroseconds, identity.processStartUnixMicroseconds);
  assert.ok(summary.elapsedSeconds >= 900 && summary.elapsedSeconds <= 905, "measurement span must be from 900 through 905 seconds");
  assert.ok(summary.samplingGapSecondsMin >= 0.5, "sampling gap fell below 0.5 seconds");
  assert.ok(summary.samplingGapSecondsMax <= 2, "sampling gap exceeded 2 seconds");
  assert.ok(qualificationProof.crossClockDriftMillisecondsMaximum <= 100, "clock drift exceeded 100 ms");
  assert.ok(collectorClockDriftNanosecondsMaximum <= maxClockDriftNanoseconds, "collector clock drift exceeded 100 ms");
  const crossClockDriftMillisecondsMaximum = Math.max(
    qualificationProof.crossClockDriftMillisecondsMaximum,
    Number(collectorClockDriftNanosecondsMaximum) / 1e6,
  );
  return {
    index,
    snapshotCount: summary.snapshotCount,
    elapsedSeconds: summary.elapsedSeconds,
    interruptWakeups: summary.interruptWakeups,
    packageIdleWakeups: summary.packageIdleWakeups,
    normalizedWakeupsPerMinute: summary.interruptWakeups / context.planBinding.plan.protocol.normalizationMinutes,
    freshProcessInstance: true,
    warmupCompleted: true,
    samplingGapSecondsMinimum: summary.samplingGapSecondsMin,
    samplingGapSecondsMaximum: summary.samplingGapSecondsMax,
    crossClockDriftMillisecondsMaximum,
    processIdentityContinuous: true,
    candidateIdentityContinuous: true,
    fixtureStable: true,
    scenarioStable: true,
    eligible: true,
  };
}

function projectQualificationResult(planBinding, preflight, windows) {
  assert.equal(windows.length, 5, "a complete qualification result requires exactly five windows");
  const rates = windows.map((window) => window.normalizedWakeupsPerMinute).sort((left, right) => left - right);
  const p95 = rates[4];
  const result = {
    schemaVersion: 1,
    contractId: "base-m4-static-settled-hidden-wakeups-v1",
    artifactKind: "qualification-result",
    planRevision: planBinding.revision,
    planSHA256: planBinding.sha256,
    resourceFixtureBinding: structuredClone(planBinding.plan.resourceFixtureBinding),
    candidate: structuredClone(preflight.candidate),
    fixtureMatch: {
      referenceMachine: true,
      dualDisplay: true,
      operatingSystemVersion: preflight.operatingSystem.version,
      operatingSystemBuild: preflight.operatingSystem.build,
      operatingSystemStableAcrossEveryTrial: true,
      stableAcrossEveryTrial: true,
    },
    scenarioAttestation: {
      fixedStillSHA256: planBinding.plan.scenario.fixedNonPersonalStillSHA256,
      planScenarioMatched: true,
      settledStatic: true,
      windowsHidden: true,
      signpostsDisabled: true,
      diagnosticsDisabled: true,
      noInteractionOrTransition: true,
      noCompetingControllerOrDiagnostics: true,
      complete: true,
    },
    protocol: structuredClone(planBinding.plan.protocol),
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
  validateQualificationResult(result, planBinding);
  return deepFreeze(result);
}

async function collectOneTrial(index, context, processLauncher, adapter) {
  let session = null;
  let terminateLaunchedProcess = null;
  let launchedProcessIdentity = null;
  let launchPromise = null;
  let launchGateClosed = false;
  let failed = false;
  let window = null;
  let collectorClockDriftNanosecondsMaximum = 0n;
  const retainClockDrift = (clockProgress) => {
    collectorClockDriftNanosecondsMaximum = clockProgress.absoluteDriftNanoseconds > collectorClockDriftNanosecondsMaximum
      ? clockProgress.absoluteDriftNanoseconds
      : collectorClockDriftNanosecondsMaximum;
    return clockProgress;
  };
  try {
    const specification = makeLaunchSpecification(index, context.planBinding, context.preflight);
    const preLaunchClock = deepFreeze(structuredClone(await adapter.captureClock(index)));
    exactKeys(preLaunchClock, ["monotonicNanoseconds", "wallClockUnixMicroseconds"], `trial ${index} pre-launch clock`);
    parseCanonicalUInt64(preLaunchClock.monotonicNanoseconds, `trial ${index} pre-launch monotonic clock`);
    parseCanonicalUInt64(preLaunchClock.wallClockUnixMicroseconds, `trial ${index} pre-launch wall clock`);
    const expectedLaunchReceipt = Object.freeze({ index });
    let gateUses = 0;
    const launchGate = Object.freeze({
      launch: () => {
        assert.equal(launchGateClosed, false, `trial ${index} attempted a process launch after the gate closed`);
        assert.equal(gateUses, 0, `trial ${index} attempted more than one process launch`);
        gateUses += 1;
        launchPromise = (async () => {
          const process = await processLauncher(specification);
          assert.ok(
            process && typeof process === "object" && !Array.isArray(process),
            `trial ${index} launched process must be an object`,
          );
          const terminate = process.terminate;
          assert.equal(typeof terminate, "function", `trial ${index} launched process must provide termination`);
          terminateLaunchedProcess = () => Reflect.apply(terminate, process, []);
          exactKeys(process, ["handle", "identity", "terminate"], `trial ${index} launched process`);
          launchedProcessIdentity = deepFreeze(structuredClone(process.identity));
          validateProcessIdentity(launchedProcessIdentity, `trial ${index} launched process.identity`);
          return Object.freeze({
            receipt: expectedLaunchReceipt,
            processHandle: process.handle,
          });
        })();
        return launchPromise;
      },
    });
    session = await adapter.openTrial(specification, launchGate);
    assert.equal(gateUses, 1, `trial ${index} did not consume its one-shot launch capability exactly once`);
    exactKeys(session, sessionKeys, `trial ${index} session`);
    assert.equal(session.launchReceipt, expectedLaunchReceipt, `trial ${index} returned an invalid launch receipt`);
    for (const key of sessionKeys.filter((key) => !["launchReceipt", "launchObservation"].includes(key))) {
      assert.equal(typeof session[key], "function", `trial ${index} session.${key} must be a function`);
    }
    const launch = deepFreeze(structuredClone(session.launchObservation));
    const launchIdentity = validateObservation(launch, context, `trial ${index} launch`);
    assert.deepEqual(
      launch.processIdentity,
      launchedProcessIdentity,
      `trial ${index} observed a process other than the collector-launched process`,
    );
    const launchClock = retainClockDrift(
      validatePairedClockProgress(preLaunchClock, launch, `trial ${index} launch`),
    );
    assert.ok(
      launchIdentity.wallStart >= launchClock.beforeWall && launchIdentity.wallStart <= launchClock.afterWall,
      `trial ${index} process start is not bounded by the collector-owned launch interval`,
    );
    assert.equal(context.processIdentities.has(launchIdentity.key), false, "a process identity was reused across trials");
    context.processIdentities.add(launchIdentity.key);
    if (context.fixtureBaseline === null) context.fixtureBaseline = structuredClone(launch.fixture);
    if (context.scenarioBaseline === null) context.scenarioBaseline = structuredClone(launch.scenario);

    const launchMonotonic = BigInt(launch.monotonicNanoseconds);
    const warmupDeadline = launchMonotonic + 300n * nanosecondsPerSecond;
    const warmup = deepFreeze(structuredClone(await session.waitUntilAbsolute(warmupDeadline.toString())));
    const warmupIdentity = validateObservation(warmup, context, `trial ${index} warm-up end`);
    assert.equal(warmupIdentity.key, launchIdentity.key, `trial ${index} process changed during warm-up`);
    const warmupClock = retainClockDrift(
      validatePairedClockProgress(launch, warmup, `trial ${index} warm-up`),
    );
    retainClockDrift(
      validatePairedClockProgress(preLaunchClock, warmup, `trial ${index} cumulative warm-up clock`),
    );
    assert.ok(warmupClock.afterMonotonic >= warmupDeadline, `trial ${index} warm-up ended before 300 seconds`);
    assert.ok(
      warmupClock.afterMonotonic - warmupDeadline <= 2n * nanosecondsPerSecond,
      `trial ${index} warm-up deadline was missed by more than two seconds`,
    );

    const measurementOrigin = warmupClock.afterMonotonic;
    const deadlines = buildAbsoluteDeadlines(measurementOrigin);
    const snapshots = [];
    for (let sampleIndex = 0; sampleIndex < deadlines.length; sampleIndex += 1) {
      const deadline = deadlines[sampleIndex];
      const snapshot = structuredClone(await session.sampleAtAbsoluteDeadline(deadline, sampleIndex));
      assert.ok(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot), `trial ${index} sample ${sampleIndex} is invalid`);
      const actualMonotonic = parseCanonicalUInt64(
        snapshot.monotonicNanoseconds,
        `trial ${index} sample ${sampleIndex}.monotonicNanoseconds`,
      );
      const requestedDeadline = BigInt(deadline);
      assert.ok(actualMonotonic >= requestedDeadline, `trial ${index} sample ${sampleIndex} preceded its absolute deadline`);
      assert.ok(
        actualMonotonic - requestedDeadline <= 2n * nanosecondsPerSecond,
        `trial ${index} sample ${sampleIndex} missed its absolute deadline by more than two seconds`,
      );
      retainClockDrift(validatePairedClockProgress(preLaunchClock, {
        monotonicNanoseconds: snapshot.monotonicNanoseconds,
        wallClockUnixMicroseconds: snapshot.wallClockUnixMicroseconds,
      }, `trial ${index} sample ${sampleIndex} cumulative clock`));
      snapshots.push(snapshot);
    }

    retainClockDrift(validatePairedClockProgress(warmup, {
      monotonicNanoseconds: snapshots[0].monotonicNanoseconds,
      wallClockUnixMicroseconds: snapshots[0].wallClockUnixMicroseconds,
    }, `trial ${index} measurement start`));

    const finish = deepFreeze(structuredClone(await session.finishTrial()));
    const finishIdentity = validateObservation(finish, context, `trial ${index} finish`);
    assert.equal(finishIdentity.key, launchIdentity.key, `trial ${index} process changed before final verification`);
    const lastSnapshot = snapshots.at(-1);
    const finalClock = retainClockDrift(validatePairedClockProgress({
      monotonicNanoseconds: lastSnapshot.monotonicNanoseconds,
      wallClockUnixMicroseconds: lastSnapshot.wallClockUnixMicroseconds,
    }, finish, `trial ${index} final observation`));
    retainClockDrift(
      validatePairedClockProgress(preLaunchClock, finish, `trial ${index} cumulative final clock`),
    );
    assert.ok(
      finalClock.afterMonotonic - finalClock.beforeMonotonic <= 2n * nanosecondsPerSecond,
      `trial ${index} final observation followed the measurement by more than two seconds`,
    );
    window = projectSanitizedWindow(
      index,
      snapshots,
      launch.processIdentity,
      context,
      collectorClockDriftNanosecondsMaximum,
    );
  } catch {
    failed = true;
  } finally {
    launchGateClosed = true;
    if (launchPromise !== null) {
      try {
        await launchPromise;
      } catch {
        failed = true;
      }
    }
    if (terminateLaunchedProcess !== null) {
      try {
        await terminateLaunchedProcess();
      } catch {
        failed = true;
      }
    }
  }
  return failed ? null : window;
}

export async function runStaticWakeupCollectorProtocol({
  planBinding,
  resourceFixtureBytes,
  resourceFixture,
  testToken = null,
  preflightProvider,
  ownerAttestationProvider,
  processLauncher,
  adapter,
}) {
  const expectedStill = planBinding.plan.scenario.fixedNonPersonalStillSHA256;
  validatePlan(planBinding.plan, resourceFixtureBytes, resourceFixture, expectedStill);
  if (expectedStill === null) return stopped("plan-not-collection-ready");
  if (testToken !== syntheticTestToken) return stopped("public-host-adapter-unavailable");
  assert.equal(typeof preflightProvider, "function", "synthetic preflight provider is required");
  assert.equal(typeof ownerAttestationProvider, "function", "synthetic owner-attestation provider is required");
  assert.equal(typeof processLauncher, "function", "collector-owned process launcher is required");
  exactKeys(adapter, ["captureClock", "openTrial"], "synthetic collector adapter");
  assert.equal(typeof adapter.captureClock, "function");
  assert.equal(typeof adapter.openTrial, "function");

  let preflight;
  try {
    preflight = deepFreeze(structuredClone(await preflightProvider({
      qualificationPlanSHA256: planBinding.sha256,
      fixedStillSHA256: expectedStill,
    })));
    validateSyntheticPreflight(preflight, planBinding.sha256);
  } catch {
    return stopped("preflight-invalid");
  }
  if (preflight.status !== "pass") return stopped(`preflight-${preflight.stopReason}`);

  try {
    const attestations = deepFreeze(structuredClone(await ownerAttestationProvider({
      qualificationPlanSHA256: planBinding.sha256,
      required: [...ownerAttestationNames],
    })));
    validateOwnerAttestations(attestations, planBinding);
  } catch {
    return stopped("owner-attestation-incomplete");
  }

  const context = {
    planBinding,
    preflight,
    processIdentities: new Set(),
    fixtureBaseline: null,
    scenarioBaseline: null,
  };
  const windows = [];
  for (let index = 1; index <= 5; index += 1) {
    const window = await collectOneTrial(index, context, processLauncher, adapter);
    if (window === null) return stopped("trial-invalid", index);
    windows.push(window);
  }
  return {
    status: "complete",
    reason: null,
    attemptedTrials: 5,
    result: projectQualificationResult(planBinding, preflight, windows),
  };
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

function makePreflight(planBinding, overrides = {}) {
  return {
    schemaVersion: 1,
    contractId: "base-m4-static-settled-hidden-wakeups-preflight-v1",
    artifactKind: "automated-preflight-result",
    claimScope: "automated-preflight-only",
    producerRevision: preflightProducerRevision,
    qualificationPlanSHA256: planBinding.sha256,
    candidate: makeCandidate(),
    operatingSystem: { version: "15.0", build: "24A1" },
    checks: Object.fromEntries(preflightCheckKeys.map((key) => [key, true])),
    status: "pass",
    stopReason: null,
    remainingOwnerAttestations: [...ownerAttestationNames],
    ...overrides,
  };
}

function makeUnavailablePreflight(planBinding) {
  const checks = Object.fromEntries(preflightCheckKeys.map((key) => [key, false]));
  checks.planCollectionReady = true;
  return makePreflight(planBinding, {
    candidate: null,
    operatingSystem: null,
    checks,
    status: "stop",
    stopReason: "public-fact-unavailable",
  });
}

function makeOwnerAttestations(planBinding) {
  return {
    qualificationPlanSHA256: planBinding.sha256,
    statements: Object.fromEntries(ownerAttestationNames.map((name) => [name, true])),
  };
}

function makeFixture(preflight) {
  return {
    referenceMachine: true,
    dualDisplay: true,
    operatingSystemVersion: preflight.operatingSystem.version,
    operatingSystemBuild: preflight.operatingSystem.build,
  };
}

function makeScenario(planBinding) {
  return {
    fixedStillSHA256: planBinding.plan.scenario.fixedNonPersonalStillSHA256,
    planScenarioMatched: true,
    settledStatic: true,
    windowsHidden: true,
    signpostsDisabled: true,
    diagnosticsDisabled: true,
    noInteractionOrTransition: true,
    noCompetingControllerOrDiagnostics: true,
  };
}

function makeSyntheticAdapter({
  planBinding,
  preflight,
  wakeups = [0, 5, 10, 15, 30],
  mutatePreLaunch,
  mutateLaunch,
  mutateWarmup,
  mutateSnapshot,
  mutateFinish,
  mutateSession,
  mutateLaunchedProcess,
  delayedProcessLaunch = false,
  rejectSetupDuringLaunch = false,
  doubleLaunch = false,
  terminateThrows = false,
}) {
  const log = {
    captureClockCalls: [], openTrialCalls: [], processLaunchCalls: [], warmupCalls: [],
    sampleCalls: [], finishCalls: [], terminateCalls: [],
  };
  const preLaunchByTrial = new Map();

  function processIdentity(index) {
    const preLaunchWall = BigInt(preLaunchByTrial.get(index).wallClockUnixMicroseconds);
    return {
      processStartAbsoluteTime: (987_654_321_000_000_000n + BigInt(index)).toString(),
      processStartUnixMicroseconds: (preLaunchWall + 5_000n).toString(),
    };
  }

  function observation(index, monotonic, wall, identity) {
    return {
      monotonicNanoseconds: monotonic.toString(),
      wallClockUnixMicroseconds: wall.toString(),
      processIdentity: structuredClone(identity),
      candidate: structuredClone(preflight.candidate),
      fixture: makeFixture(preflight),
      scenario: makeScenario(planBinding),
      fixtureContinuityObserved: true,
      scenarioContinuityObserved: true,
    };
  }

  const processLauncher = async (specification) => {
    log.processLaunchCalls.push(specification.index);
    if (delayedProcessLaunch) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const process = {
      handle: Object.freeze({ index: specification.index }),
      identity: processIdentity(specification.index),
      async terminate() {
        log.terminateCalls.push(specification.index);
        if (terminateThrows) throw new Error("synthetic terminate failure");
      },
    };
    if (mutateLaunchedProcess) mutateLaunchedProcess(process, specification);
    return process;
  };

  const adapter = {
    async captureClock(index) {
      log.captureClockCalls.push(index);
      const value = {
        monotonicNanoseconds: (1_000_000_000_000n + BigInt(index) * 2_000_000_000_000n).toString(),
        wallClockUnixMicroseconds: (1_800_000_000_000_000n + BigInt(index) * 2_000_000_000n).toString(),
      };
      if (mutatePreLaunch) mutatePreLaunch(value, index);
      preLaunchByTrial.set(index, structuredClone(value));
      return value;
    },

    async openTrial(specification, launchGate) {
      log.openTrialCalls.push(specification.index);
      const index = specification.index;
      const pendingLaunch = launchGate.launch();
      if (rejectSetupDuringLaunch) throw new Error("synthetic setup failure during launch");
      const launched = await pendingLaunch;
      if (doubleLaunch) await launchGate.launch();
      assert.equal(launched.processHandle.index, index);
      const preLaunch = preLaunchByTrial.get(index);
      const preLaunchMonotonic = BigInt(preLaunch.monotonicNanoseconds);
      const preLaunchWall = BigInt(preLaunch.wallClockUnixMicroseconds);
      const launchMonotonic = preLaunchMonotonic + 10_000_000n;
      const launchWall = preLaunchWall + 10_000n;
      const identity = processIdentity(index);
      const launchObservation = observation(index, launchMonotonic, launchWall, identity);
      if (mutateLaunch) mutateLaunch(launchObservation, specification);
      let measurementOriginMonotonic = null;
      let measurementOriginWall = null;
      let lastSnapshot = null;

      const session = {
        launchReceipt: launched.receipt,
        launchObservation,
        async waitUntilAbsolute(deadline) {
          log.warmupCalls.push({ index, deadline });
          const target = BigInt(deadline);
          const wall = launchWall + (target - launchMonotonic) / 1000n;
          const value = observation(index, target, wall, identity);
          if (mutateWarmup) mutateWarmup(value, specification, deadline);
          measurementOriginMonotonic = BigInt(value.monotonicNanoseconds);
          measurementOriginWall = BigInt(value.wallClockUnixMicroseconds);
          return value;
        },
        async sampleAtAbsoluteDeadline(deadline, sampleIndex) {
          log.sampleCalls.push({ index, sampleIndex, deadline });
          const target = BigInt(deadline);
          const offset = target - measurementOriginMonotonic;
          const value = {
            monotonicNanoseconds: target.toString(),
            wallClockUnixMicroseconds: (measurementOriginWall + offset / 1000n).toString(),
            processStartAbsoluteTime: identity.processStartAbsoluteTime,
            processStartUnixMicroseconds: identity.processStartUnixMicroseconds,
            physicalFootprintBytes: "20971520",
            packageIdleWakeups: "5",
            interruptWakeups: String(10 + (sampleIndex === 900 ? wakeups[index - 1] : 0)),
            diskReadBytes: "100",
            diskWrittenBytes: "0",
          };
          if (mutateSnapshot) mutateSnapshot(value, specification, sampleIndex, deadline);
          lastSnapshot = structuredClone(value);
          return value;
        },
        async finishTrial() {
          log.finishCalls.push(index);
          const finalMonotonic = BigInt(lastSnapshot.monotonicNanoseconds) + 1_000_000n;
          const finalWall = BigInt(lastSnapshot.wallClockUnixMicroseconds) + 1_000n;
          const value = observation(index, finalMonotonic, finalWall, identity);
          if (mutateFinish) mutateFinish(value, specification);
          return value;
        },
      };
      if (mutateSession) mutateSession(session, specification);
      return session;
    },
  };
  return { adapter, processLauncher, log };
}

async function runSelfTest() {
  const [planBytes, resourceFixtureBytes, qualificationSchemaBytes] = await Promise.all([
    readFile(planPath), readFile(resourceFixturePath), readFile(qualificationSchemaPath),
  ]);
  const resourceFixture = JSON.parse(resourceFixtureBytes);
  const currentPlanBinding = makePlanBinding(expectedPlanRevision, planBytes);
  const readyPlan = structuredClone(currentPlanBinding.plan);
  readyPlan.scenario.fixedNonPersonalStillSHA256 = fixedStillSHA256;
  const readyPlanBinding = makePlanBinding("a".repeat(40), Buffer.from(`${JSON.stringify(readyPlan)}\n`));
  const { default: Ajv2020 } = await import("../services/mcp/node_modules/ajv/dist/2020.js");
  let positives = 0;
  let negatives = 0;

  let preflightCalls = 0;
  let attestationCalls = 0;
  const untouchedAdapter = { captureClock: async () => assert.fail(), openTrial: async () => assert.fail() };
  const currentStop = await runStaticWakeupCollectorProtocol({
    planBinding: currentPlanBinding,
    resourceFixtureBytes,
    resourceFixture,
    preflightProvider: async () => { preflightCalls += 1; },
    ownerAttestationProvider: async () => { attestationCalls += 1; },
    adapter: untouchedAdapter,
  });
  assert.deepEqual(currentStop, stopped("plan-not-collection-ready"));
  assert.equal(preflightCalls, 0);
  assert.equal(attestationCalls, 0);
  positives += 1;

  const inaccessibleReadyPath = await runStaticWakeupCollectorProtocol({
    planBinding: readyPlanBinding,
    resourceFixtureBytes,
    resourceFixture,
  });
  assert.deepEqual(inaccessibleReadyPath, stopped("public-host-adapter-unavailable"));
  positives += 1;

  const unavailableAdapter = makeSyntheticAdapter({
    planBinding: readyPlanBinding,
    preflight: makePreflight(readyPlanBinding),
  });
  const unavailablePreflight = await runStaticWakeupCollectorProtocol({
    planBinding: readyPlanBinding,
    resourceFixtureBytes,
    resourceFixture,
    testToken: syntheticTestToken,
    preflightProvider: async () => makeUnavailablePreflight(readyPlanBinding),
    ownerAttestationProvider: async () => assert.fail(),
    processLauncher: unavailableAdapter.processLauncher,
    adapter: unavailableAdapter.adapter,
  });
  assert.deepEqual(unavailablePreflight, stopped("preflight-public-fact-unavailable"));
  assert.deepEqual(unavailableAdapter.log.processLaunchCalls, []);
  positives += 1;

  async function runSynthetic({
    wakeups, mutatePreflight, mutateAttestations, ...adapterOptions
  } = {}) {
    const preflight = makePreflight(readyPlanBinding);
    if (mutatePreflight) mutatePreflight(preflight);
    const attestations = makeOwnerAttestations(readyPlanBinding);
    if (mutateAttestations) mutateAttestations(attestations);
    const synthetic = makeSyntheticAdapter({
      planBinding: readyPlanBinding, preflight, wakeups, ...adapterOptions,
    });
    const outcome = await runStaticWakeupCollectorProtocol({
      planBinding: readyPlanBinding,
      resourceFixtureBytes,
      resourceFixture,
      testToken: syntheticTestToken,
      preflightProvider: async () => structuredClone(preflight),
      ownerAttestationProvider: async () => structuredClone(attestations),
      processLauncher: synthetic.processLauncher,
      adapter: synthetic.adapter,
    });
    return { outcome, log: synthetic.log };
  }

  const conforming = await runSynthetic();
  assert.equal(conforming.outcome.status, "complete");
  assert.equal(conforming.outcome.result.qualification, "scenario-pass");
  assert.equal(conforming.outcome.result.aggregate.p95WakeupsPerMinute, 2);
  assert.deepEqual(conforming.log.processLaunchCalls, [1, 2, 3, 4, 5]);
  assert.equal(conforming.log.sampleCalls.length, 4_505);
  assert.deepEqual(conforming.log.terminateCalls, [1, 2, 3, 4, 5]);
  const sanitizedJSON = JSON.stringify(conforming.outcome.result);
  assert.equal(sanitizedJSON.includes("987654321000000001"), false);
  assert.equal(sanitizedJSON.includes("1800000002005000"), false);
  positives += 1;

  const highValid = await runSynthetic({ wakeups: [0, 5, 10, 15, 31] });
  assert.equal(highValid.outcome.status, "complete");
  assert.equal(highValid.outcome.result.qualification, "scenario-fail");
  assert.equal(highValid.outcome.result.aggregate.p95WakeupsPerMinute, 31 / 15);
  assert.deepEqual(highValid.log.processLaunchCalls, [1, 2, 3, 4, 5]);
  positives += 1;

  const delayedButEligible = await runSynthetic({
    mutateSnapshot: (snapshot, _specification, sampleIndex) => {
      const accumulatedDelay = BigInt(sampleIndex) * 2_000_000n;
      snapshot.monotonicNanoseconds = (BigInt(snapshot.monotonicNanoseconds) + accumulatedDelay).toString();
      snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) + accumulatedDelay / 1000n).toString();
    },
  });
  assert.equal(delayedButEligible.outcome.status, "complete");
  assert.ok(delayedButEligible.outcome.result.windows.every((window) => window.elapsedSeconds === 901.8));
  assert.equal(delayedButEligible.outcome.result.windows[4].normalizedWakeupsPerMinute, 2);
  positives += 1;

  const boundedBoundaryClockDrift = await runSynthetic({
    mutateWarmup: (warmup) => {
      warmup.wallClockUnixMicroseconds = (BigInt(warmup.wallClockUnixMicroseconds) + 90_000n).toString();
    },
  });
  assert.equal(boundedBoundaryClockDrift.outcome.status, "complete");
  assert.ok(
    boundedBoundaryClockDrift.outcome.result.windows.every(
      (window) => window.crossClockDriftMillisecondsMaximum === 90,
    ),
  );
  positives += 1;

  let terminatorGetterReads = 0;
  const singleReadTerminator = await runSynthetic({
    mutateLaunchedProcess: (process) => {
      const terminate = process.terminate;
      let served = false;
      Object.defineProperty(process, "terminate", {
        enumerable: true,
        configurable: true,
        get() {
          terminatorGetterReads += 1;
          if (served) return undefined;
          served = true;
          return terminate;
        },
      });
    },
  });
  assert.equal(singleReadTerminator.outcome.status, "complete");
  assert.equal(terminatorGetterReads, 5);
  assert.deepEqual(singleReadTerminator.log.terminateCalls, [1, 2, 3, 4, 5]);
  positives += 1;

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const qualificationSchema = JSON.parse(qualificationSchemaBytes);
  ajv.addSchema(qualificationSchema);
  const activeValidator = ajv.getSchema(qualificationSchema.$id);
  const completeValidator = ajv.getSchema(`${qualificationSchema.$id}#/$defs/completeResult`);
  assert.equal(completeValidator(conforming.outcome.result), true, JSON.stringify(completeValidator.errors));
  assert.equal(activeValidator(conforming.outcome.result), false, "the active schema accepted a synthetic result");
  positives += 1;

  const preflightTamperCases = [
    (x) => { x.qualificationPlanSHA256 = "9".repeat(64); },
    (x) => { x.checks.acPower = 1; },
    (x) => { x.candidate.executableSHA256 = "0".repeat(64); },
  ];
  for (const tamper of preflightTamperCases) {
    const result = await runSynthetic({ mutatePreflight: tamper });
    assert.deepEqual(result.outcome, stopped("preflight-invalid"));
    assert.deepEqual(result.log.processLaunchCalls, []);
    negatives += 1;
  }

  const attestationTamperCases = [
    (x) => { delete x.statements[ownerAttestationNames[0]]; },
    (x) => { x.statements[ownerAttestationNames[1]] = false; },
    (x) => { x.statements[ownerAttestationNames[2]] = 1; },
    (x) => { x.qualificationPlanSHA256 = "9".repeat(64); },
  ];
  for (const tamper of attestationTamperCases) {
    const result = await runSynthetic({ mutateAttestations: tamper });
    assert.deepEqual(result.outcome, stopped("owner-attestation-incomplete"));
    assert.deepEqual(result.log.processLaunchCalls, []);
    negatives += 1;
  }

  const trialCases = [
    { options: { mutateSession: (session) => { session.extra = true; } }, expectedTrial: 1 },
    {
      options: {
        mutateLaunchedProcess: (process) => {
          process.unexpected = true;
        },
      },
      expectedTrial: 1,
    },
    {
      options: {
        delayedProcessLaunch: true,
        rejectSetupDuringLaunch: true,
      },
      expectedTrial: 1,
    },
    {
      options: {
        mutateSession: (session) => {
          session.launchReceipt = Object.freeze({ index: 1 });
        },
      },
      expectedTrial: 1,
    },
    { options: { doubleLaunch: true }, expectedTrial: 1 },
    {
      options: {
        mutateLaunch: (launch, specification) => {
          if (specification.index === 3) {
            launch.processIdentity.processStartAbsoluteTime = (
              BigInt(launch.processIdentity.processStartAbsoluteTime) + 1_000n
            ).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateLaunch: (launch, specification) => {
          if (specification.index === 3) launch.processIdentity.processStartUnixMicroseconds = (BigInt(launch.wallClockUnixMicroseconds) - 20_000n).toString();
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateLaunch: (launch, specification) => {
          if (specification.index === 3) launch.processIdentity.processStartUnixMicroseconds = (BigInt(launch.wallClockUnixMicroseconds) + 1n).toString();
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateLaunch: (launch, specification) => {
          if (specification.index === 2) {
            launch.processIdentity.processStartAbsoluteTime = "987654321000000001";
            launch.processIdentity.processStartUnixMicroseconds = "1800000002005000";
          }
        },
      },
      expectedTrial: 2,
    },
    {
      options: {
        mutateWarmup: (warmup, specification, deadline) => {
          if (specification.index === 3) warmup.monotonicNanoseconds = (BigInt(deadline) - 1n).toString();
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateWarmup: (warmup, specification) => {
          if (specification.index === 3) warmup.wallClockUnixMicroseconds = (BigInt(warmup.wallClockUnixMicroseconds) + 101_000n).toString();
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateWarmup: (warmup, specification) => {
          if (specification.index === 3) {
            warmup.wallClockUnixMicroseconds = (BigInt(warmup.wallClockUnixMicroseconds) + 90_000n).toString();
          }
        },
        mutateSnapshot: (snapshot, specification) => {
          if (specification.index === 3) {
            snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) + 90_000n).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex, deadline) => {
          if (specification.index === 3 && sampleIndex === 0) snapshot.monotonicNanoseconds = (BigInt(deadline) - 1n).toString();
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, _sampleIndex, deadline) => {
          if (specification.index === 3) {
            snapshot.monotonicNanoseconds = (BigInt(deadline) + 500n * nanosecondsPerSecond).toString();
            snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) + 500n * microsecondsPerSecond).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification) => {
          if (specification.index === 3) {
            snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) + 500n * microsecondsPerSecond).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex) => {
          if (specification.index === 3 && sampleIndex === 1) {
            snapshot.monotonicNanoseconds = (BigInt(snapshot.monotonicNanoseconds) - 501_000_000n).toString();
            snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) - 501_000n).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex) => {
          if (specification.index === 3 && sampleIndex > 0) {
            snapshot.monotonicNanoseconds = (BigInt(snapshot.monotonicNanoseconds) + 1_001_000_000n).toString();
            snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) + 1_001_000n).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex) => {
          if (specification.index === 3) snapshot.wallClockUnixMicroseconds = (BigInt(snapshot.wallClockUnixMicroseconds) + BigInt(sampleIndex) * 100_000n).toString();
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex) => {
          if (specification.index === 3 && sampleIndex === 900) snapshot.interruptWakeups = "9";
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex) => {
          if (specification.index === 3 && sampleIndex === 900) snapshot.packageIdleWakeups = "99";
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateSnapshot: (snapshot, specification, sampleIndex) => {
          if (specification.index === 3 && sampleIndex === 450) snapshot.processStartAbsoluteTime = "7";
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) finish.candidate.executableSHA256 = "8".repeat(64);
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) finish.fixture.operatingSystemBuild = "24A2";
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) finish.fixtureContinuityObserved = 1;
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) finish.scenario.fixedStillSHA256 = "8".repeat(64);
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) finish.scenarioContinuityObserved = false;
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) finish.processIdentity.processStartAbsoluteTime = "8";
        },
      },
      expectedTrial: 3,
    },
    {
      options: {
        mutateFinish: (finish, specification) => {
          if (specification.index === 3) {
            finish.monotonicNanoseconds = (BigInt(finish.monotonicNanoseconds) + 3n * nanosecondsPerSecond).toString();
            finish.wallClockUnixMicroseconds = (BigInt(finish.wallClockUnixMicroseconds) + 3n * microsecondsPerSecond).toString();
          }
        },
      },
      expectedTrial: 3,
    },
    { options: { terminateThrows: true }, expectedTrial: 1 },
    {
      options: {
        mutateSession: (_session, specification) => {
          if (specification.index === 1) specification.index = 2;
        },
      },
      expectedTrial: 1,
    },
  ];

  for (const [caseIndex, testCase] of trialCases.entries()) {
    const result = await runSynthetic(testCase.options);
    assert.deepEqual(
      result.outcome,
      stopped("trial-invalid", testCase.expectedTrial),
      `trial tamper case ${caseIndex} did not fail closed`,
    );
    assert.deepEqual(
      result.log.processLaunchCalls,
      Array.from({ length: testCase.expectedTrial }, (_, index) => index + 1),
      "invalid trial must stop without retry or replacement",
    );
    assert.deepEqual(
      result.log.terminateCalls,
      Array.from(
        { length: testCase.expectedTerminations ?? testCase.expectedTrial },
        (_, index) => index + 1,
      ),
      `trial tamper case ${caseIndex} did not terminate every launched trial exactly once`,
    );
    negatives += 1;
  }

  assert.throws(() => buildAbsoluteDeadlines("01"), /canonical decimal/);
  assert.throws(() => buildAbsoluteDeadlines(maxUInt64), /exceed uint64/);
  negatives += 2;

  console.log(
    `Static-wakeup collector protocol valid: ${positives} positive and ${negatives} fail-closed cases passed; synthetic rows only, no host evidence collected.`,
  );
}

async function productionMain() {
  const [planBytes, resourceFixtureBytes] = await Promise.all([
    readFile(planPath), readFile(resourceFixturePath),
  ]);
  const outcome = await runStaticWakeupCollectorProtocol({
    planBinding: makePlanBinding(expectedPlanRevision, planBytes),
    resourceFixtureBytes,
    resourceFixture: JSON.parse(resourceFixtureBytes),
  });
  assert.deepEqual(outcome, stopped("plan-not-collection-ready"));
  process.stderr.write(
    "Static-wakeup collector stopped: plan-not-collection-ready; no preflight, host adapter, or process launch invoked.\n",
  );
  process.exitCode = 1;
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--self-test") {
    await runSelfTest();
    return;
  }
  if (process.argv.length !== 2) {
    process.stderr.write("usage: collect_m4_static_wakeup_qualification.mjs [--self-test]\n");
    process.exitCode = 2;
    return;
  }
  await productionMain();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Static-wakeup collector failed closed: ${error.message}`);
    process.exitCode = 1;
  });
}
