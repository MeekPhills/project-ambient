#!/usr/bin/env node

import assert from "node:assert/strict";

const snapshotKeys = [
  "monotonicNanoseconds",
  "wallClockUnixMicroseconds",
  "processStartAbsoluteTime",
  "processStartUnixMicroseconds",
  "packageIdleWakeups",
  "interruptWakeups",
  "diskReadBytes",
  "diskWrittenBytes",
];
const snapshotKeySet = [...snapshotKeys].sort();
const maxUInt64 = (1n << 64n) - 1n;
const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function parseUInt64(value, field) {
  assert.match(value, /^(0|[1-9][0-9]*)$/, `${field} must be a canonical decimal uint64 string`);
  const parsed = BigInt(value);
  assert.ok(parsed <= maxUInt64, `${field} exceeds uint64`);
  return parsed;
}

function parseSnapshot(value, index) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `snapshot ${index} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), snapshotKeySet, `snapshot ${index} has unexpected or missing keys`);
  return Object.fromEntries(snapshotKeys.map((key) => [key, parseUInt64(value[key], `snapshot ${index}.${key}`)]));
}

function safeDelta(after, before, field) {
  const delta = after[field] - before[field];
  assert.ok(delta >= 0n, `${field} counter regressed`);
  assert.ok(delta <= maxSafeInteger, `${field} delta exceeds Number.MAX_SAFE_INTEGER`);
  return Number(delta);
}

function summarizeProcessRusageSeries(snapshots, eventLimit = 256, expectedSnapshotCount = null) {
  assert.ok(Number.isSafeInteger(eventLimit) && eventLimit >= 1 && eventLimit <= 10_000, "event limit must be an integer from 1 through 10000");
  assert.ok(Array.isArray(snapshots) && snapshots.length >= 2, "at least two snapshots are required");
  assert.ok(expectedSnapshotCount === null || (Number.isSafeInteger(expectedSnapshotCount) && expectedSnapshotCount >= 2 && expectedSnapshotCount <= 259_201), "expected snapshot count must be null or an integer from 2 through 259201");
  assert.ok(expectedSnapshotCount === null || snapshots.length === expectedSnapshotCount, `expected ${expectedSnapshotCount} snapshots but received ${snapshots.length}`);

  const rows = snapshots.map(parseSnapshot);
  const first = rows[0];
  const last = rows.at(-1);
  assert.ok(first.processStartAbsoluteTime > 0n, "process start token must be positive");
  assert.ok(first.processStartUnixMicroseconds > 0n, "process start wall-clock token must be positive");
  assert.ok(rows.every((row) => row.processStartAbsoluteTime === first.processStartAbsoluteTime), "pid identity changed during measurement");
  assert.ok(rows.every((row) => row.processStartUnixMicroseconds === first.processStartUnixMicroseconds), "pid wall-clock identity changed during measurement");
  assert.ok(first.processStartUnixMicroseconds <= first.wallClockUnixMicroseconds, "process start follows the first snapshot");

  const elapsedNanoseconds = last.monotonicNanoseconds - first.monotonicNanoseconds;
  assert.ok(elapsedNanoseconds > 0n && elapsedNanoseconds <= maxSafeInteger, "elapsed time is invalid");

  const activityEvents = [];
  let activityEventCount = 0;
  let samplingGapSecondsMin = Number.POSITIVE_INFINITY;
  let samplingGapSecondsMax = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    assert.ok(after.monotonicNanoseconds > before.monotonicNanoseconds, `snapshot ${index} monotonic time did not advance`);
    assert.ok(after.wallClockUnixMicroseconds > before.wallClockUnixMicroseconds, `snapshot ${index} wall clock did not advance`);
    const monotonicGapNanoseconds = after.monotonicNanoseconds - before.monotonicNanoseconds;
    const wallGapNanoseconds = (after.wallClockUnixMicroseconds - before.wallClockUnixMicroseconds) * 1000n;
    assert.ok(monotonicGapNanoseconds <= maxSafeInteger && wallGapNanoseconds <= maxSafeInteger, `snapshot ${index} sampling gap exceeds Number.MAX_SAFE_INTEGER`);
    const crossClockDrift = wallGapNanoseconds - monotonicGapNanoseconds;
    assert.ok(crossClockDrift >= -100_000_000n && crossClockDrift <= 100_000_000n, `snapshot ${index} wall and monotonic clocks diverged by more than 100 ms`);
    const samplingGapSeconds = Number(monotonicGapNanoseconds) / 1e9;
    samplingGapSecondsMin = Math.min(samplingGapSecondsMin, samplingGapSeconds);
    samplingGapSecondsMax = Math.max(samplingGapSecondsMax, samplingGapSeconds);

    const interruptWakeups = safeDelta(after, before, "interruptWakeups");
    const packageIdleWakeups = safeDelta(after, before, "packageIdleWakeups");
    const diskReadBytes = safeDelta(after, before, "diskReadBytes");
    const diskWrittenBytes = safeDelta(after, before, "diskWrittenBytes");
    assert.ok(packageIdleWakeups <= interruptWakeups, `snapshot ${index} package-idle wakeups exceed interrupt wakeups`);

    if (interruptWakeups > 0 || packageIdleWakeups > 0 || diskReadBytes > 0 || diskWrittenBytes > 0) {
      activityEventCount += 1;
      if (activityEvents.length < eventLimit) {
        const offsetNanoseconds = after.monotonicNanoseconds - first.monotonicNanoseconds;
        assert.ok(offsetNanoseconds <= maxSafeInteger, `snapshot ${index} event offset exceeds Number.MAX_SAFE_INTEGER`);
        activityEvents.push({
          offsetSeconds: Number(offsetNanoseconds) / 1e9,
          endUnixMicroseconds: after.wallClockUnixMicroseconds.toString(),
          interruptWakeups,
          packageIdleWakeups,
          diskReadBytes,
          diskWrittenBytes,
        });
      }
    }
  }

  const elapsedSeconds = Number(elapsedNanoseconds) / 1e9;
  const interruptWakeups = safeDelta(last, first, "interruptWakeups");
  const packageIdleWakeups = safeDelta(last, first, "packageIdleWakeups");
  assert.ok(packageIdleWakeups <= interruptWakeups, "package-idle wakeups exceed interrupt wakeups");

  return {
    available: true,
    reason: null,
    snapshotCount: rows.length,
    elapsedSeconds,
    processStartAbsoluteTime: first.processStartAbsoluteTime.toString(),
    processStartUnixMicroseconds: first.processStartUnixMicroseconds.toString(),
    firstSnapshotUnixMicroseconds: first.wallClockUnixMicroseconds.toString(),
    lastSnapshotUnixMicroseconds: last.wallClockUnixMicroseconds.toString(),
    samplingGapSecondsMin,
    samplingGapSecondsMax,
    packageIdleWakeups,
    interruptWakeups,
    totalWakeups: interruptWakeups,
    wakeupsPerMinute: interruptWakeups * 60 / elapsedSeconds,
    diskReadBytes: safeDelta(last, first, "diskReadBytes"),
    diskWrittenBytes: safeDelta(last, first, "diskWrittenBytes"),
    activityEventCount,
    reportedActivityEventCount: activityEvents.length,
    activityEventsTruncated: activityEventCount > activityEvents.length,
    activityEvents,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    monotonicNanoseconds: "1000000000",
    wallClockUnixMicroseconds: "1700000000000000",
    processStartAbsoluteTime: "42",
    processStartUnixMicroseconds: "1699999999000000",
    packageIdleWakeups: "5",
    interruptWakeups: "10",
    diskReadBytes: "100",
    diskWrittenBytes: "0",
    ...overrides,
  };
}

function runSelfTest() {
  const rows = [
    makeSnapshot(),
    makeSnapshot({ monotonicNanoseconds: "2000000000", wallClockUnixMicroseconds: "1700000001000000", interruptWakeups: "11" }),
    makeSnapshot({ monotonicNanoseconds: "3000000000", wallClockUnixMicroseconds: "1700000002000000", packageIdleWakeups: "6", interruptWakeups: "12", diskReadBytes: "164", diskWrittenBytes: "32" }),
  ];
  const summary = summarizeProcessRusageSeries(rows, 1, 3);
  assert.equal(summary.snapshotCount, 3);
  assert.equal(summary.elapsedSeconds, 2);
  assert.equal(summary.processStartAbsoluteTime, "42");
  assert.equal(summary.processStartUnixMicroseconds, "1699999999000000");
  assert.equal(summary.firstSnapshotUnixMicroseconds, "1700000000000000");
  assert.equal(summary.lastSnapshotUnixMicroseconds, "1700000002000000");
  assert.equal(summary.samplingGapSecondsMin, 1);
  assert.equal(summary.samplingGapSecondsMax, 1);
  assert.equal(summary.packageIdleWakeups, 1);
  assert.equal(summary.interruptWakeups, 2);
  assert.equal(summary.totalWakeups, 2, "package-idle subset must not be added twice");
  assert.equal(summary.wakeupsPerMinute, 60);
  assert.equal(summary.diskReadBytes, 64);
  assert.equal(summary.diskWrittenBytes, 32);
  assert.equal(summary.activityEventCount, 2);
  assert.equal(summary.reportedActivityEventCount, 1);
  assert.equal(summary.activityEventsTruncated, true);
  assert.equal(summary.activityEvents[0].endUnixMicroseconds, "1700000001000000");

  assert.throws(() => summarizeProcessRusageSeries([rows[0]]), /at least two snapshots/);
  assert.throws(() => summarizeProcessRusageSeries(rows, 1, 4), /expected 4 snapshots but received 3/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], processStartAbsoluteTime: "43" }]), /pid identity changed/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], processStartUnixMicroseconds: "1699999998000000" }]), /wall-clock identity changed/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], interruptWakeups: "9" }]), /counter regressed/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], packageIdleWakeups: "7", interruptWakeups: "11" }]), /package-idle wakeups exceed/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], extra: "0" }]), /unexpected or missing keys/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], diskReadBytes: "9007199254741092" }]), /Number.MAX_SAFE_INTEGER/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], monotonicNanoseconds: rows[0].monotonicNanoseconds }]), /monotonic time did not advance|elapsed time is invalid/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], wallClockUnixMicroseconds: rows[0].wallClockUnixMicroseconds }]), /wall clock did not advance/);
  assert.throws(() => summarizeProcessRusageSeries([rows[0], { ...rows[1], wallClockUnixMicroseconds: "1700000002000000" }]), /diverged/);
  console.log("process-rusage series self-test: 12 positive/negative cases passed");
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  if (process.argv[2] === "--self-test") {
    assert.equal(process.argv.length, 3, "--self-test accepts no additional arguments");
    runSelfTest();
    return;
  }

  assert.ok(process.argv.length >= 2 && process.argv.length <= 4, "usage: summarize_process_rusage_series.mjs [event-limit] [expected-snapshot-count]");
  const eventLimit = process.argv[2] === undefined ? 256 : Number(process.argv[2]);
  const expectedSnapshotCount = process.argv[3] === undefined ? null : Number(process.argv[3]);
  const input = (await readStdin()).trim();
  assert.ok(input.length > 0, "snapshot input is empty");
  const snapshots = input.split(/\n+/).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`snapshot ${index} is invalid JSON: ${error.message}`);
    }
  });
  process.stdout.write(`${JSON.stringify(summarizeProcessRusageSeries(snapshots, eventLimit, expectedSnapshotCount))}\n`);
}

main().catch((error) => {
  console.error(`process-rusage series validation failed: ${error.message}`);
  process.exitCode = 1;
});
