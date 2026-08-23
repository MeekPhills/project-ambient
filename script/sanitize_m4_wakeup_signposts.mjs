#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const artifactVersion = 1;
const fixtureId = "base-2024-m4-mac-mini-16gb-256gb";
const subsystem = "io.projectambient.mac";
const category = "WakeupAttribution.v1";
const wakeupCeiling = 2;
const maxSeriesBytes = 1024 * 1024;
const maxLogBytes = 4 * 1024 * 1024;
const maxLogLineBytes = 64 * 1024;
const maxSignpostRecords = 256;
const maxLogStderrBytes = 64 * 1024;
const maxPid = 2_147_483_647;
const microsecondsPerSecond = 1_000_000n;
const maxUInt64 = (1n << 64n) - 1n;

const eventNames = [
  "lifecycle.launch",
  "lifecycle.will_sleep",
  "lifecycle.did_wake",
  "lifecycle.screen_locked",
  "lifecycle.screen_unlocked",
  "display.configuration_changed",
  "power.state_changed",
  "clock_or_timezone.changed",
  "state.local_changed",
  "state.external_changed",
  "rotation.boundary_fired",
];
const eventNameSet = new Set(eventNames);
const eventOrder = new Map(eventNames.map((name, index) => [name, index]));

const topLevelKeys = [
  "fixtureId",
  "pid",
  "startedAt",
  "completedAt",
  "samples",
  "intervalSeconds",
  "processRusageSeries",
  "budgetObservation",
  "storageObservation",
  "measurementCoverage",
  "qualification",
];
const processSeriesKeys = [
  "available",
  "reason",
  "snapshotCount",
  "elapsedSeconds",
  "processStartAbsoluteTime",
  "processStartUnixMicroseconds",
  "firstSnapshotUnixMicroseconds",
  "lastSnapshotUnixMicroseconds",
  "samplingGapSecondsMin",
  "samplingGapSecondsMax",
  "packageIdleWakeups",
  "interruptWakeups",
  "totalWakeups",
  "wakeupsPerMinute",
  "diskReadBytes",
  "diskWrittenBytes",
  "activityEventCount",
  "reportedActivityEventCount",
  "activityEventsTruncated",
  "activityEvents",
];
const activityEventKeys = [
  "offsetSeconds",
  "startUnixMicroseconds",
  "endUnixMicroseconds",
  "interruptWakeups",
  "packageIdleWakeups",
  "diskReadBytes",
  "diskWrittenBytes",
];

function assertObject(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unexpected or missing keys`);
}

function assertSafeInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  assert.ok(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} must be a safe integer from ${minimum} through ${maximum}`);
}

function assertFiniteNumber(value, label, minimum = 0) {
  assert.ok(Number.isFinite(value) && value >= minimum, `${label} must be a finite number no less than ${minimum}`);
}

function parseCanonicalUInt64(value, label) {
  assert.equal(typeof value, "string", `${label} must be a canonical decimal uint64 string`);
  assert.match(value, /^(0|[1-9][0-9]*)$/, `${label} must be a canonical decimal uint64 string`);
  const parsed = BigInt(value);
  assert.ok(parsed <= maxUInt64, `${label} exceeds uint64`);
  return parsed;
}

function parseTimestampParts(value, label) {
  assert.equal(typeof value, "string", `${label} must be a timestamp string`);
  const rfc3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
  const apple = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-]\d{4})$/;
  const match = value.match(rfc3339) ?? value.match(apple);
  assert.ok(match, `${label} must be an anchored timezone-qualified timestamp with at most microsecond precision`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = "", zoneText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  assert.ok(year >= 2000 && year <= 9999, `${label} year is outside the supported range`);
  assert.ok(hour <= 23 && minute <= 59 && second <= 59, `${label} time is invalid`);

  const localWholeSecond = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(localWholeSecond);
  assert.ok(
    check.getUTCFullYear() === year
      && check.getUTCMonth() === month - 1
      && check.getUTCDate() === day
      && check.getUTCHours() === hour
      && check.getUTCMinutes() === minute
      && check.getUTCSeconds() === second,
    `${label} calendar date is invalid`,
  );

  let offsetMinutes = 0;
  if (zoneText !== "Z") {
    const compact = zoneText.replace(":", "");
    const sign = compact[0] === "+" ? 1 : -1;
    const offsetHours = Number(compact.slice(1, 3));
    const offsetMinutePart = Number(compact.slice(3, 5));
    assert.ok(offsetHours <= 23 && offsetMinutePart <= 59, `${label} timezone offset is invalid`);
    offsetMinutes = sign * (offsetHours * 60 + offsetMinutePart);
  }

  const epochWholeMilliseconds = localWholeSecond - offsetMinutes * 60_000;
  const fractionMicroseconds = BigInt(fractionText.padEnd(6, "0") || "0");
  return BigInt(epochWholeMilliseconds) * 1000n + fractionMicroseconds;
}

function parseCanonicalUTCSecond(value, label) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${label} must be canonical whole-second UTC RFC 3339`);
  return parseTimestampParts(value, label);
}

function parseCanonicalUTCMicrosecond(value, label) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/, `${label} must be canonical microsecond UTC RFC 3339`);
  return parseTimestampParts(value, label);
}

function formatUnixMicroseconds(value) {
  assert.ok(value >= 0n && value <= maxUInt64, "timestamp is outside uint64 range");
  const seconds = value / microsecondsPerSecond;
  const fraction = (value % microsecondsPerSecond).toString().padStart(6, "0");
  assert.ok(seconds <= BigInt(Number.MAX_SAFE_INTEGER), "timestamp seconds exceed Number.MAX_SAFE_INTEGER");
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.${fraction}Z`;
}

function ceilToWholeSecond(value) {
  return ((value + microsecondsPerSecond - 1n) / microsecondsPerSecond) * microsecondsPerSecond;
}

function approximatelyEqual(actual, expected) {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) <= Number.EPSILON * scale * 4;
}

function validateSeries(series) {
  assertExactKeys(series, topLevelKeys, "series");
  assert.equal(series.fixtureId, fixtureId, "series fixtureId is not the canonical Base-M4 fixture");
  assertSafeInteger(series.pid, "series.pid", 1, maxPid);
  assertSafeInteger(series.samples, "series.samples", 2, 259_201);
  assertFiniteNumber(series.intervalSeconds, "series.intervalSeconds", Number.MIN_VALUE);
  assert.equal(series.intervalSeconds, 1, "correlation requires the one-second sampling interval");
  assert.ok((series.samples - 1) * series.intervalSeconds <= 259_200, "series planned duration exceeds 72 hours");

  const startedMicros = parseCanonicalUTCMicrosecond(series.startedAt, "series.startedAt");
  const completedMicros = parseCanonicalUTCMicrosecond(series.completedAt, "series.completedAt");
  assert.ok(startedMicros < completedMicros, "series wall-clock window must advance");

  assertExactKeys(series.processRusageSeries, processSeriesKeys, "series.processRusageSeries");
  const processSeries = series.processRusageSeries;
  assert.equal(processSeries.available, true, "process-rusage series must be available");
  assert.equal(processSeries.reason, null, "available process-rusage series reason must be null");
  assertSafeInteger(processSeries.snapshotCount, "processRusageSeries.snapshotCount", 2, 259_201);
  assert.equal(processSeries.snapshotCount, series.samples, "snapshot count does not match requested samples");
  assertFiniteNumber(processSeries.elapsedSeconds, "processRusageSeries.elapsedSeconds", Number.MIN_VALUE);
  const processStartAbsoluteTime = parseCanonicalUInt64(processSeries.processStartAbsoluteTime, "processRusageSeries.processStartAbsoluteTime");
  const processStartMicros = parseCanonicalUInt64(processSeries.processStartUnixMicroseconds, "processRusageSeries.processStartUnixMicroseconds");
  const firstSnapshotMicros = parseCanonicalUInt64(processSeries.firstSnapshotUnixMicroseconds, "processRusageSeries.firstSnapshotUnixMicroseconds");
  const lastSnapshotMicros = parseCanonicalUInt64(processSeries.lastSnapshotUnixMicroseconds, "processRusageSeries.lastSnapshotUnixMicroseconds");
  assert.ok(processStartAbsoluteTime > 0n && processStartMicros > 0n, "process-start identity must be positive");
  assert.ok(processStartMicros <= firstSnapshotMicros, "process start follows the first snapshot");
  assert.ok(firstSnapshotMicros < lastSnapshotMicros, "exact snapshot window must advance");
  assert.equal(startedMicros, firstSnapshotMicros, "series.startedAt does not match the first snapshot anchor");
  assert.equal(completedMicros, lastSnapshotMicros, "series.completedAt does not match the last snapshot anchor");
  assertFiniteNumber(processSeries.samplingGapSecondsMin, "processRusageSeries.samplingGapSecondsMin", Number.MIN_VALUE);
  assertFiniteNumber(processSeries.samplingGapSecondsMax, "processRusageSeries.samplingGapSecondsMax", Number.MIN_VALUE);
  assert.ok(processSeries.samplingGapSecondsMin <= processSeries.samplingGapSecondsMax, "sampling-gap bounds are inverted");
  assert.ok(processSeries.samplingGapSecondsMin >= 0.5, "sampling cadence contains a sub-half-second gap");
  assert.ok(processSeries.samplingGapSecondsMax <= 2, "sampling cadence contains a gap over two seconds");

  for (const key of [
    "packageIdleWakeups",
    "interruptWakeups",
    "totalWakeups",
    "diskReadBytes",
    "diskWrittenBytes",
    "activityEventCount",
    "reportedActivityEventCount",
  ]) {
    assertSafeInteger(processSeries[key], `processRusageSeries.${key}`);
  }
  assertFiniteNumber(processSeries.wakeupsPerMinute, "processRusageSeries.wakeupsPerMinute");
  assert.equal(processSeries.totalWakeups, processSeries.interruptWakeups, "total wakeups must equal interrupt wakeups");
  assert.ok(processSeries.packageIdleWakeups <= processSeries.interruptWakeups, "package-idle wakeups exceed interrupt wakeups");
  assert.equal(processSeries.activityEventsTruncated, false, "truncated activity events cannot be correlated fail-closed");
  assert.ok(Array.isArray(processSeries.activityEvents), "processRusageSeries.activityEvents must be an array");
  assert.equal(processSeries.reportedActivityEventCount, processSeries.activityEvents.length, "reported activity-event count is inconsistent");
  assert.equal(processSeries.activityEventCount, processSeries.reportedActivityEventCount, "complete activity-event details are required");
  assert.ok(processSeries.activityEventCount <= series.samples - 1, "activity-event count exceeds the number of sampling intervals");
  assert.ok(processSeries.activityEventCount <= 256, "correlation accepts at most 256 complete activity events");

  const sums = {
    interruptWakeups: 0,
    packageIdleWakeups: 0,
    diskReadBytes: 0,
    diskWrittenBytes: 0,
  };
  let priorOffset = 0;
  let priorEventEndMicros = firstSnapshotMicros;
  for (const [index, event] of processSeries.activityEvents.entries()) {
    assertExactKeys(event, activityEventKeys, `activity event ${index}`);
    assertFiniteNumber(event.offsetSeconds, `activity event ${index}.offsetSeconds`, Number.MIN_VALUE);
    assert.ok(event.offsetSeconds > priorOffset, `activity event ${index} offset must advance strictly`);
    assert.ok(event.offsetSeconds <= processSeries.elapsedSeconds, `activity event ${index} exceeds the measurement window`);
    priorOffset = event.offsetSeconds;
    const eventStartMicros = parseCanonicalUInt64(event.startUnixMicroseconds, `activity event ${index}.startUnixMicroseconds`);
    const eventEndMicros = parseCanonicalUInt64(event.endUnixMicroseconds, `activity event ${index}.endUnixMicroseconds`);
    assert.ok(eventStartMicros >= priorEventEndMicros, `activity event ${index} wall-clock interval overlaps or regresses`);
    assert.ok(eventEndMicros > eventStartMicros, `activity event ${index} wall-clock interval must advance`);
    assert.ok(eventEndMicros <= lastSnapshotMicros, `activity event ${index} wall-clock end exceeds the measurement window`);
    priorEventEndMicros = eventEndMicros;
    const intervalSeconds = Number(eventEndMicros - eventStartMicros) / 1e6;
    assert.ok(intervalSeconds >= 0.5 && intervalSeconds <= 2, `activity event ${index} interval is outside the accepted cadence`);
    assert.ok(
      intervalSeconds >= processSeries.samplingGapSecondsMin - 0.1 - 1e-9
        && intervalSeconds <= processSeries.samplingGapSecondsMax + 0.1 + 1e-9,
      `activity event ${index} interval conflicts with the declared sampling-gap extrema`,
    );
    const wallOffsetSeconds = Number(eventEndMicros - firstSnapshotMicros) / 1e6;
    assert.ok(Math.abs(wallOffsetSeconds - event.offsetSeconds) <= 0.1, `activity event ${index} wall and monotonic offsets diverged by more than 100 ms`);
    for (const key of ["interruptWakeups", "packageIdleWakeups", "diskReadBytes", "diskWrittenBytes"]) {
      assertSafeInteger(event[key], `activity event ${index}.${key}`);
      sums[key] += event[key];
      assert.ok(Number.isSafeInteger(sums[key]), `activity event ${key} sum exceeds Number.MAX_SAFE_INTEGER`);
    }
    assert.ok(event.packageIdleWakeups <= event.interruptWakeups, `activity event ${index} package-idle wakeups exceed interrupt wakeups`);
    assert.ok(["interruptWakeups", "packageIdleWakeups", "diskReadBytes", "diskWrittenBytes"].some((key) => event[key] > 0), `activity event ${index} contains no activity`);
  }

  for (const key of Object.keys(sums)) {
    assert.equal(sums[key], processSeries[key], `activity-event sum does not match processRusageSeries.${key}`);
  }
  const recomputedRate = processSeries.interruptWakeups * 60 / processSeries.elapsedSeconds;
  assert.ok(approximatelyEqual(processSeries.wakeupsPerMinute, recomputedRate), "wakeups-per-minute value is inconsistent");

  assertExactKeys(
    series.budgetObservation,
    ["wakeupsPerMinuteCeiling", "observedWindowRateWithinCeiling", "contractConformance", "contractConformanceReason"],
    "series.budgetObservation",
  );
  assert.equal(series.budgetObservation.wakeupsPerMinuteCeiling, wakeupCeiling, "wakeup ceiling is not the canonical fixture value");
  assert.equal(typeof series.budgetObservation.observedWindowRateWithinCeiling, "boolean", "observed window comparison must be boolean");
  assert.equal(series.budgetObservation.observedWindowRateWithinCeiling, recomputedRate <= wakeupCeiling, "observed window comparison is inconsistent");
  assert.equal(series.budgetObservation.contractConformance, null, "correlation input cannot claim contract conformance");
  assert.equal(
    series.budgetObservation.contractConformanceReason,
    "requires-p95-after-warm-up-and-complete-fixture",
    "contract-conformance reason is unexpected",
  );

  assertExactKeys(series.storageObservation, ["writesObservedInWindow"], "series.storageObservation");
  assert.equal(typeof series.storageObservation.writesObservedInWindow, "boolean", "storage observation must be boolean");
  assert.equal(series.storageObservation.writesObservedInWindow, processSeries.diskWrittenBytes > 0, "storage observation is inconsistent");
  assertExactKeys(series.measurementCoverage, ["wakeups", "storageChurn"], "series.measurementCoverage");
  assert.equal(series.measurementCoverage.wakeups, "partial", "wakeup coverage must remain partial");
  assert.equal(series.measurementCoverage.storageChurn, "partial", "storage coverage must remain partial");
  assert.equal(series.qualification, "partial-wakeup-series-only", "series qualification is unexpected");

  const wallElapsedSeconds = Number(completedMicros - startedMicros) / 1e6;
  assert.ok(wallElapsedSeconds <= 259_202, "series wall-clock window exceeds the bounded 72-hour protocol");
  assert.ok(processSeries.elapsedSeconds <= 259_202, "series monotonic window exceeds the bounded 72-hour protocol");
  assert.ok(Math.abs(wallElapsedSeconds - processSeries.elapsedSeconds) <= 0.1, "wall-clock and monotonic windows differ by more than 100 ms");
  const averageSamplingGap = processSeries.elapsedSeconds / (series.samples - 1);
  assert.ok(averageSamplingGap >= processSeries.samplingGapSecondsMin - 1e-9, "average sampling gap is below the declared minimum");
  assert.ok(averageSamplingGap <= processSeries.samplingGapSecondsMax + 1e-9, "average sampling gap exceeds the declared maximum");

  return {
    series,
    processSeries,
    startedMicros,
    completedMicros,
    processStartMicros,
    queryEndMicros: ceilToWholeSecond(completedMicros),
  };
}

function validateQueryStart(value, seriesInfo) {
  const queryStartMicros = parseCanonicalUTCSecond(value, "query start");
  assert.ok(queryStartMicros < seriesInfo.startedMicros, "query start must precede the measurement window");
  assert.ok(queryStartMicros <= seriesInfo.processStartMicros, "query start must not follow the measured process start");
  const lookbackMicros = seriesInfo.startedMicros - queryStartMicros;
  assert.ok(lookbackMicros <= 3600n * microsecondsPerSecond, "query lookback exceeds 3600 seconds");
  return queryStartMicros;
}

function validatePayloadField(value, eventName, label) {
  assert.ok(
    value === undefined || value === null || value === "" || value === eventName,
    `${label} contains a prohibited signpost payload`,
  );
}

class NDJSONSanitizer {
  constructor(seriesInfo, queryStartMicros) {
    this.seriesInfo = seriesInfo;
    this.queryStartMicros = queryStartMicros;
    this.pending = Buffer.alloc(0);
    this.totalBytes = 0;
    this.recordCount = 0;
    this.terminalSeen = false;
    this.events = [];
  }

  push(chunk) {
    assert.ok(Buffer.isBuffer(chunk), "log output chunk must be a Buffer");
    this.totalBytes += chunk.length;
    assert.ok(this.totalBytes <= maxLogBytes, "log output exceeds the 4 MiB bound");
    this.pending = Buffer.concat([this.pending, chunk]);

    let newlineIndex;
    while ((newlineIndex = this.pending.indexOf(0x0a)) !== -1) {
      let line = this.pending.subarray(0, newlineIndex);
      this.pending = this.pending.subarray(newlineIndex + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      this.consumeLine(line);
    }
    assert.ok(this.pending.length <= maxLogLineBytes, "log output line exceeds the 64 KiB bound");
  }

  finish() {
    if (this.pending.length > 0) this.consumeLine(this.pending);
    this.pending = Buffer.alloc(0);
    assert.equal(this.terminalSeen, true, "log output is missing its terminal completion record");
    return this.events;
  }

  consumeLine(line) {
    assert.ok(line.length > 0, "log output contains a blank interior record");
    assert.ok(line.length <= maxLogLineBytes, "log output line exceeds the 64 KiB bound");
    assert.equal(this.terminalSeen, false, "log output contains records after its terminal completion record");

    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
    } catch {
      throw new Error("log output contains malformed NDJSON");
    }
    assertObject(value, "log record");

    if (Object.hasOwn(value, "finished") || Object.hasOwn(value, "count")) {
      assertExactKeys(value, ["count", "finished"], "log terminal record");
      assertSafeInteger(value.count, "log terminal count", 0, maxSignpostRecords);
      assert.equal(value.finished, 1, "log terminal completion marker is invalid");
      assert.equal(value.count, this.recordCount, "log terminal count does not match received records");
      this.terminalSeen = true;
      return;
    }

    this.recordCount += 1;
    assert.ok(this.recordCount <= maxSignpostRecords, "log output contains more than 256 records");
    assert.equal(typeof value.eventType, "string", "log record eventType is missing");
    assert.notEqual(value.eventType, "lossEvent", "unified-log loss was observed");
    assert.equal(value.eventType, "signpostEvent", "query admitted a non-signpost event");
    assert.equal(value.processID, this.seriesInfo.series.pid, "signpost PID does not match the measured process");
    assert.equal(value.subsystem, subsystem, "signpost subsystem is unexpected");
    assert.equal(value.category, category, "signpost category is unexpected");
    assert.equal(typeof value.signpostName, "string", "signpost name is missing");
    assert.ok(eventNameSet.has(value.signpostName), "signpost name is outside the fixed catalog");
    assert.equal(typeof value.signpostType, "string", "signpost type is missing");
    assert.equal(value.signpostType.toLowerCase(), "event", "only point-event signposts are accepted");
    validatePayloadField(value.eventMessage, value.signpostName, "eventMessage");
    validatePayloadField(value.composedMessage, value.signpostName, "composedMessage");
    validatePayloadField(value.formatString, value.signpostName, "formatString");

    const timestampMicros = parseTimestampParts(value.timestamp, "signpost timestamp");
    assert.ok(timestampMicros >= this.queryStartMicros, "signpost precedes the bounded query start");
    assert.ok(timestampMicros <= this.seriesInfo.queryEndMicros, "signpost follows the bounded query end");
    this.events.push({ eventName: value.signpostName, timestampMicros });
  }
}

function correlate(seriesInfo, queryStartMicros, events) {
  const launchEvents = events.filter((event) => event.eventName === "lifecycle.launch");
  assert.equal(launchEvents.length, 1, "exactly one lifecycle.launch marker is required");
  const launch = launchEvents[0];
  assert.ok(launch.timestampMicros < seriesInfo.startedMicros, "lifecycle.launch must precede the measurement window");
  assert.ok(launch.timestampMicros >= seriesInfo.processStartMicros, "lifecycle.launch precedes the measured process incarnation");
  assert.ok(events.every((event) => event.timestampMicros >= launch.timestampMicros), "signposts preceding lifecycle.launch indicate ambiguous PID history");

  const grouped = new Map();
  const windowEvents = [];
  let signpostEventCount = 0;
  for (const event of events) {
    if (event.timestampMicros < seriesInfo.startedMicros) continue;
    assert.notEqual(event.eventName, "lifecycle.launch", "lifecycle.launch inside the measurement window is invalid");
    if (event.timestampMicros > seriesInfo.completedMicros) continue;
    windowEvents.push(event);
    const offsetSecond = Number((event.timestampMicros - seriesInfo.startedMicros) / microsecondsPerSecond);
    const key = `${offsetSecond}\u0000${event.eventName}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { eventName: event.eventName, offsetSecond, count: 1 });
    signpostEventCount += 1;
  }

  const signposts = [...grouped.values()].sort(
    (left, right) => left.offsetSecond - right.offsetSecond
      || eventOrder.get(left.eventName) - eventOrder.get(right.eventName),
  );
  const wakeupBuckets = seriesInfo.processSeries.activityEvents
    .filter((event) => event.interruptWakeups > 0)
    .map((event) => {
      const eventStartMicros = parseCanonicalUInt64(event.startUnixMicroseconds, "activity-event wall-clock start");
      const eventEndMicros = parseCanonicalUInt64(event.endUnixMicroseconds, "activity-event wall-clock end");
      const nearby = new Map();
      for (const signpost of windowEvents) {
        if (signpost.timestampMicros < eventStartMicros - microsecondsPerSecond
          || signpost.timestampMicros > eventEndMicros + microsecondsPerSecond) continue;
        const offsetSecond = Number((signpost.timestampMicros - seriesInfo.startedMicros) / microsecondsPerSecond);
        const relation = signpost.timestampMicros < eventStartMicros
          ? "adjacent-before"
          : signpost.timestampMicros > eventEndMicros ? "adjacent-after" : "same";
        const key = `${offsetSecond}\u0000${signpost.eventName}\u0000${relation}`;
        const existing = nearby.get(key);
        if (existing) existing.count += 1;
        else nearby.set(key, { eventName: signpost.eventName, offsetSecond, relation, count: 1 });
      }
      const nearbySignposts = [...nearby.values()].sort(
        (left, right) => left.offsetSecond - right.offsetSecond
          || eventOrder.get(left.eventName) - eventOrder.get(right.eventName)
          || left.relation.localeCompare(right.relation),
      );
      return {
        endOffsetSeconds: event.offsetSeconds,
        interruptWakeups: event.interruptWakeups,
        nearbySignposts,
      };
    });
  const wakeupBucketsWithNearbySignposts = wakeupBuckets.filter((bucket) => bucket.nearbySignposts.length > 0).length;

  return {
    artifactVersion,
    claimScope: "bounded-post-hoc-correlation-aid-only",
    fixtureId: seriesInfo.series.fixtureId,
    pid: seriesInfo.series.pid,
    measurementWindow: {
      startedAt: seriesInfo.series.startedAt,
      completedAt: seriesInfo.series.completedAt,
      elapsedSeconds: seriesInfo.processSeries.elapsedSeconds,
      intervalSeconds: seriesInfo.series.intervalSeconds,
    },
    query: {
      lookbackSeconds: Number(seriesInfo.startedMicros - queryStartMicros) / 1e6,
      subsystem,
      category,
      complete: true,
      lossObserved: false,
      launchRetrievable: true,
    },
    signposts,
    wakeupBuckets,
    summary: {
      signpostEventCount,
      wakeupBucketCount: wakeupBuckets.length,
      wakeupBucketsWithNearbySignposts,
      wakeupBucketsWithoutNearbySignposts: wakeupBuckets.length - wakeupBucketsWithNearbySignposts,
    },
    causation: null,
    qualification: null,
    budgetEligibility: "ineligible-signposts-on-window",
  };
}

function parseAndCorrelate(series, queryStart, ndjson, childStatus = 0) {
  assert.equal(childStatus, 0, "log show exited unsuccessfully");
  const seriesInfo = validateSeries(series);
  const queryStartMicros = validateQueryStart(queryStart, seriesInfo);
  const parser = new NDJSONSanitizer(seriesInfo, queryStartMicros);
  parser.push(Buffer.from(ndjson));
  return correlate(seriesInfo, queryStartMicros, parser.finish());
}

function toLogDate(canonicalUTC) {
  return canonicalUTC.replace("T", " ").replace("Z", "+0000");
}

function toLogDateFromWholeMicroseconds(value) {
  assert.equal(value % microsecondsPerSecond, 0n, "log query bound must be a whole second");
  return formatUnixMicroseconds(value).replace("T", " ").replace(".000000Z", "+0000");
}

async function runLogQuery(seriesInfo, queryStart, queryStartMicros) {
  await access("/usr/bin/log", fsConstants.X_OK);
  const predicate = `type == "lossEvent" OR (type == "signpostEvent" AND processIdentifier == ${seriesInfo.series.pid} AND subsystem == "${subsystem}" AND category == "${category}")`;
  const args = [
    "show",
    "--style", "ndjson",
    "--signpost",
    "--loss",
    "--info",
    "--debug",
    "--no-backtrace",
    "--no-pager",
    "--color", "none",
    "--timezone", "UTC",
    "--start", toLogDate(queryStart),
    "--end", toLogDateFromWholeMicroseconds(seriesInfo.queryEndMicros),
    "--predicate", predicate,
  ];
  const parser = new NDJSONSanitizer(seriesInfo, queryStartMicros);

  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/log", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let parserError = null;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk) => {
      if (parserError) return;
      try {
        parser.push(chunk);
      } catch (error) {
        parserError = error;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxLogStderrBytes && !parserError) {
        parserError = new Error("log show stderr exceeded its bound");
        child.kill("SIGTERM");
      }
    });
    child.once("error", () => reject(new Error("log show could not be started")));
    child.once("close", (code, signal) => {
      if (parserError) reject(parserError);
      else if (code !== 0 || signal !== null) reject(new Error("log show exited unsuccessfully"));
      else resolve();
    });
  });

  return correlate(seriesInfo, queryStartMicros, parser.finish());
}

function makeActivityEvent(overrides = {}) {
  const { offsetSeconds = 1.2, startOffsetSeconds = Math.max(0, offsetSeconds - 1), ...fieldOverrides } = overrides;
  const firstSnapshotMicros = parseCanonicalUTCMicrosecond("2026-08-23T11:00:00.100000Z", "synthetic first snapshot");
  return {
    offsetSeconds,
    startUnixMicroseconds: (firstSnapshotMicros + BigInt(Math.round(startOffsetSeconds * 1e6))).toString(),
    endUnixMicroseconds: (firstSnapshotMicros + BigInt(Math.round(offsetSeconds * 1e6))).toString(),
    interruptWakeups: 1,
    packageIdleWakeups: 0,
    diskReadBytes: 0,
    diskWrittenBytes: 0,
    ...fieldOverrides,
  };
}

function makeSeries(activityEvents = [
  makeActivityEvent(),
  makeActivityEvent({ offsetSeconds: 2.2, interruptWakeups: 0, diskReadBytes: 5 }),
  makeActivityEvent({ offsetSeconds: 3.2, interruptWakeups: 2, packageIdleWakeups: 1 }),
]) {
  const sums = activityEvents.reduce(
    (result, event) => {
      for (const key of ["interruptWakeups", "packageIdleWakeups", "diskReadBytes", "diskWrittenBytes"]) result[key] += event[key];
      return result;
    },
    { interruptWakeups: 0, packageIdleWakeups: 0, diskReadBytes: 0, diskWrittenBytes: 0 },
  );
  const elapsedSeconds = 4;
  const wakeupsPerMinute = sums.interruptWakeups * 60 / elapsedSeconds;
  return {
    fixtureId,
    pid: 1042,
    startedAt: "2026-08-23T11:00:00.100000Z",
    completedAt: "2026-08-23T11:00:04.100000Z",
    samples: 5,
    intervalSeconds: 1,
    processRusageSeries: {
      available: true,
      reason: null,
      snapshotCount: 5,
      elapsedSeconds,
      processStartAbsoluteTime: "42",
      processStartUnixMicroseconds: parseCanonicalUTCMicrosecond("2026-08-23T10:59:00.000000Z", "synthetic process start").toString(),
      firstSnapshotUnixMicroseconds: parseCanonicalUTCMicrosecond("2026-08-23T11:00:00.100000Z", "synthetic first snapshot").toString(),
      lastSnapshotUnixMicroseconds: parseCanonicalUTCMicrosecond("2026-08-23T11:00:04.100000Z", "synthetic last snapshot").toString(),
      samplingGapSecondsMin: 1,
      samplingGapSecondsMax: 1,
      packageIdleWakeups: sums.packageIdleWakeups,
      interruptWakeups: sums.interruptWakeups,
      totalWakeups: sums.interruptWakeups,
      wakeupsPerMinute,
      diskReadBytes: sums.diskReadBytes,
      diskWrittenBytes: sums.diskWrittenBytes,
      activityEventCount: activityEvents.length,
      reportedActivityEventCount: activityEvents.length,
      activityEventsTruncated: false,
      activityEvents,
    },
    budgetObservation: {
      wakeupsPerMinuteCeiling: wakeupCeiling,
      observedWindowRateWithinCeiling: wakeupsPerMinute <= wakeupCeiling,
      contractConformance: null,
      contractConformanceReason: "requires-p95-after-warm-up-and-complete-fixture",
    },
    storageObservation: { writesObservedInWindow: sums.diskWrittenBytes > 0 },
    measurementCoverage: { wakeups: "partial", storageChurn: "partial" },
    qualification: "partial-wakeup-series-only",
  };
}

function makeLogEvent(eventName, timestamp, overrides = {}) {
  return {
    timestamp,
    eventType: "signpostEvent",
    processID: 1042,
    subsystem,
    category,
    signpostName: eventName,
    signpostType: "Event",
    eventMessage: eventName,
    formatString: eventName,
    processImagePath: "/prohibited/raw/path/that-must-never-survive",
    ...overrides,
  };
}

function makeNDJSON(records, terminalOverrides = {}) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n${JSON.stringify({ count: records.length, finished: 1, ...terminalOverrides })}\n`;
}

function clone(value) {
  return structuredClone(value);
}

function runSelfTest() {
  const queryStart = "2026-08-23T10:59:00Z";
  const launch = makeLogEvent("lifecycle.launch", "2026-08-23 10:59:50.000000+0000");
  const records = [
    launch,
    makeLogEvent("power.state_changed", "2026-08-23T11:00:01.100000Z"),
    makeLogEvent("power.state_changed", "2026-08-23T11:00:01.900000Z"),
    makeLogEvent("state.local_changed", "2026-08-23T11:00:02.100000Z"),
    makeLogEvent("rotation.boundary_fired", "2026-08-23T11:00:04.100000Z"),
    makeLogEvent("power.state_changed", "2026-08-23T11:00:04.500000Z"),
  ];
  const output = parseAndCorrelate(makeSeries(), queryStart, makeNDJSON(records));
  assert.deepEqual(
    Object.keys(output).sort(),
    [
      "artifactVersion",
      "budgetEligibility",
      "causation",
      "claimScope",
      "fixtureId",
      "measurementWindow",
      "pid",
      "qualification",
      "query",
      "signposts",
      "summary",
      "wakeupBuckets",
    ].sort(),
    "retained artifact top-level keys must remain closed",
  );
  assert.deepEqual(Object.keys(output.measurementWindow).sort(), ["completedAt", "elapsedSeconds", "intervalSeconds", "startedAt"], "measurement-window keys must remain closed");
  assert.deepEqual(Object.keys(output.query).sort(), ["category", "complete", "launchRetrievable", "lookbackSeconds", "lossObserved", "subsystem"], "query keys must remain closed");
  assert.deepEqual(Object.keys(output.summary).sort(), ["signpostEventCount", "wakeupBucketCount", "wakeupBucketsWithNearbySignposts", "wakeupBucketsWithoutNearbySignposts"], "summary keys must remain closed");
  assert.ok(output.signposts.every((event) => Object.keys(event).sort().join(",") === "count,eventName,offsetSecond"), "retained signpost keys must remain closed");
  assert.ok(output.wakeupBuckets.every((bucket) => Object.keys(bucket).sort().join(",") === "endOffsetSeconds,interruptWakeups,nearbySignposts"), "retained wakeup-bucket keys must remain closed");
  assert.ok(output.wakeupBuckets.flatMap((bucket) => bucket.nearbySignposts).every((event) => Object.keys(event).sort().join(",") === "count,eventName,offsetSecond,relation"), "nearby-signpost keys must remain closed");
  assert.equal(output.artifactVersion, 1);
  assert.equal(output.claimScope, "bounded-post-hoc-correlation-aid-only");
  assert.equal(output.budgetEligibility, "ineligible-signposts-on-window");
  assert.equal(output.causation, null);
  assert.equal(output.qualification, null);
  assert.equal(output.summary.signpostEventCount, 4);
  assert.equal(output.summary.wakeupBucketCount, 2, "disk-only activity must not become a wakeup bucket");
  assert.deepEqual(output.signposts[0], { eventName: "power.state_changed", offsetSecond: 1, count: 2 });
  assert.ok(output.wakeupBuckets[0].nearbySignposts.some((event) => event.relation === "same"));
  assert.ok(output.wakeupBuckets[0].nearbySignposts.some((event) => event.relation === "adjacent-after"));
  assert.ok(output.wakeupBuckets[1].nearbySignposts.some((event) => event.relation === "adjacent-before"));
  assert.ok(output.wakeupBuckets[1].nearbySignposts.some((event) => event.relation === "adjacent-after"));
  const twoSecondGap = makeSeries([makeActivityEvent({ offsetSeconds: 5, startOffsetSeconds: 3 })]);
  twoSecondGap.completedAt = "2026-08-23T11:00:05.100000Z";
  twoSecondGap.processRusageSeries.elapsedSeconds = 5;
  twoSecondGap.processRusageSeries.lastSnapshotUnixMicroseconds = parseCanonicalUTCMicrosecond("2026-08-23T11:00:05.100000Z", "synthetic delayed last snapshot").toString();
  twoSecondGap.processRusageSeries.wakeupsPerMinute = 12;
  twoSecondGap.processRusageSeries.samplingGapSecondsMax = 2;
  const intervalBound = parseAndCorrelate(
    twoSecondGap,
    queryStart,
    makeNDJSON([launch, makeLogEvent("power.state_changed", "2026-08-23T11:00:03.110000Z")]),
  );
  assert.equal(intervalBound.wakeupBuckets[0].nearbySignposts[0].relation, "same", "a handler inside a two-second activity interval must not be lost to bucket flooring");
  const serializedOutput = JSON.stringify(output);
  for (const prohibited of ["prohibited/raw/path", "eventMessage", "composedMessage", "formatString", "processImagePath", "signpostIdentifier", "threadIdentifier", "bootUUID"]) {
    assert.equal(serializedOutput.includes(prohibited), false, `raw metadata leaked into retained output: ${prohibited}`);
  }

  const quietSeries = makeSeries([]);
  const quiet = parseAndCorrelate(quietSeries, queryStart, makeNDJSON([launch]));
  assert.equal(quiet.summary.signpostEventCount, 0);
  assert.equal(quiet.summary.wakeupBucketCount, 0);

  const tamperCases = [
    ["unknown event", () => makeNDJSON([launch, makeLogEvent("unknown.event", "2026-08-23T11:00:01Z")])],
    ["loss event", () => makeNDJSON([{ eventType: "lossEvent" }])],
    ["message payload", () => makeNDJSON([launch, makeLogEvent("power.state_changed", "2026-08-23T11:00:01Z", { eventMessage: "power.state_changed secret" })])],
    ["format payload", () => makeNDJSON([launch, makeLogEvent("power.state_changed", "2026-08-23T11:00:01Z", { formatString: "%{public}s" })])],
    ["composed payload", () => makeNDJSON([launch, makeLogEvent("power.state_changed", "2026-08-23T11:00:01Z", { composedMessage: "power.state_changed private" })])],
    ["wrong pid", () => makeNDJSON([{ ...launch, processID: 1043 }])],
    ["wrong subsystem", () => makeNDJSON([{ ...launch, subsystem: "other" }])],
    ["wrong category", () => makeNDJSON([{ ...launch, category: "other" }])],
    ["wrong event type", () => makeNDJSON([{ ...launch, eventType: "logEvent" }])],
    ["wrong signpost type", () => makeNDJSON([{ ...launch, signpostType: "begin" }])],
    ["missing launch", () => makeNDJSON([makeLogEvent("power.state_changed", "2026-08-23T11:00:01Z")])],
    ["duplicate launch", () => makeNDJSON([launch, { ...launch, timestamp: "2026-08-23T10:59:51Z" }])],
    ["in-window launch", () => makeNDJSON([{ ...launch, timestamp: "2026-08-23T11:00:01Z" }])],
    ["malformed timestamp", () => makeNDJSON([{ ...launch, timestamp: "not-a-time" }])],
    ["timezone-free timestamp", () => makeNDJSON([{ ...launch, timestamp: "2026-08-23 10:59:50" }])],
    ["impossible timestamp", () => makeNDJSON([{ ...launch, timestamp: "2026-02-30T10:59:50Z" }])],
    ["before query timestamp", () => makeNDJSON([{ ...launch, timestamp: "2026-08-23T10:58:59Z" }])],
    ["after query timestamp", () => makeNDJSON([launch, makeLogEvent("power.state_changed", "2026-08-23T11:00:05.000001Z")])],
    ["ambiguous pid history", () => makeNDJSON([makeLogEvent("power.state_changed", "2026-08-23T10:59:40Z"), launch])],
  ];
  for (const [name, makeInput] of tamperCases) {
    assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, makeInput()), undefined, `${name} must be rejected`);
  }

  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, "{bad json}\n"), /malformed NDJSON/);
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, `${JSON.stringify(launch)}\n`), /terminal/);
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, makeNDJSON([launch], { count: 2 })), /count/);
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, makeNDJSON([launch], { extra: true })), /unexpected or missing keys/);
  assert.throws(
    () => parseAndCorrelate(makeSeries(), queryStart, `${JSON.stringify({ count: 0, finished: 1 })}\n${JSON.stringify(launch)}\n`),
    /after its terminal/,
  );
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, `${JSON.stringify(launch)}\n\n${JSON.stringify({ count: 1, finished: 1 })}\n`), /blank interior/);
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, `${"x".repeat(maxLogLineBytes + 1)}\n`), /64 KiB/);
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, "x".repeat(maxLogBytes + 1)), /4 MiB/);
  assert.throws(() => parseAndCorrelate(makeSeries(), queryStart, makeNDJSON([launch]), 1), /exited unsuccessfully/);

  const extraSeries = makeSeries();
  extraSeries.credit = 1;
  assert.throws(() => parseAndCorrelate(extraSeries, queryStart, makeNDJSON([launch])), /unexpected or missing keys/);
  const wrongFixture = makeSeries();
  wrongFixture.fixtureId = "other";
  assert.throws(() => parseAndCorrelate(wrongFixture, queryStart, makeNDJSON([launch])), /fixtureId/);
  const missingSeriesKey = makeSeries();
  delete missingSeriesKey.storageObservation;
  assert.throws(() => parseAndCorrelate(missingSeriesKey, queryStart, makeNDJSON([launch])), /unexpected or missing keys/);
  const wrongCeiling = makeSeries();
  wrongCeiling.budgetObservation.wakeupsPerMinuteCeiling = 3;
  assert.throws(() => parseAndCorrelate(wrongCeiling, queryStart, makeNDJSON([launch])), /ceiling/);
  const falseClaim = makeSeries();
  falseClaim.budgetObservation.contractConformance = true;
  assert.throws(() => parseAndCorrelate(falseClaim, queryStart, makeNDJSON([launch])), /conformance/);
  const wrongQualification = makeSeries();
  wrongQualification.qualification = "qualified";
  assert.throws(() => parseAndCorrelate(wrongQualification, queryStart, makeNDJSON([launch])), /qualification/);
  const wrongSamples = makeSeries();
  wrongSamples.processRusageSeries.snapshotCount = 4;
  assert.throws(() => parseAndCorrelate(wrongSamples, queryStart, makeNDJSON([launch])), /snapshot count/);
  const wrongInterval = makeSeries();
  wrongInterval.intervalSeconds = 2;
  assert.throws(() => parseAndCorrelate(wrongInterval, queryStart, makeNDJSON([launch])), /one-second/);
  const delayedCadence = makeSeries();
  delayedCadence.processRusageSeries.samplingGapSecondsMax = 3;
  assert.throws(() => parseAndCorrelate(delayedCadence, queryStart, makeNDJSON([launch])), /gap over two seconds/);
  const impossibleActiveInterval = makeSeries([makeActivityEvent({ offsetSeconds: 2, startOffsetSeconds: 0 })]);
  assert.throws(() => parseAndCorrelate(impossibleActiveInterval, queryStart, makeNDJSON([launch])), /declared sampling-gap extrema/);
  const truncated = makeSeries();
  truncated.processRusageSeries.activityEventsTruncated = true;
  assert.throws(() => parseAndCorrelate(truncated, queryStart, makeNDJSON([launch])), /truncated/);
  const wrongAggregate = makeSeries();
  wrongAggregate.processRusageSeries.interruptWakeups += 1;
  wrongAggregate.processRusageSeries.totalWakeups += 1;
  assert.throws(() => parseAndCorrelate(wrongAggregate, queryStart, makeNDJSON([launch])), /sum/);
  const invalidSubset = makeSeries([makeActivityEvent({ interruptWakeups: 1, packageIdleWakeups: 2 })]);
  assert.throws(() => parseAndCorrelate(invalidSubset, queryStart, makeNDJSON([launch])), /package-idle/);
  const unsafe = makeSeries();
  unsafe.processRusageSeries.diskReadBytes = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => parseAndCorrelate(unsafe, queryStart, makeNDJSON([launch])), /safe integer/);
  const wrongRate = makeSeries();
  wrongRate.processRusageSeries.wakeupsPerMinute += 1;
  assert.throws(() => parseAndCorrelate(wrongRate, queryStart, makeNDJSON([launch])), /wakeups-per-minute/);
  const wrongStorage = makeSeries();
  wrongStorage.storageObservation.writesObservedInWindow = true;
  assert.throws(() => parseAndCorrelate(wrongStorage, queryStart, makeNDJSON([launch])), /storage observation/);
  const wallMismatch = makeSeries();
  wallMismatch.completedAt = "2026-08-23T11:00:04.200000Z";
  assert.throws(() => parseAndCorrelate(wallMismatch, queryStart, makeNDJSON([launch])), /does not match/);
  const activityAnchorMismatch = makeSeries();
  activityAnchorMismatch.processRusageSeries.activityEvents[0].startUnixMicroseconds = parseCanonicalUTCMicrosecond("2026-08-23T11:00:00.900000Z", "synthetic drift start").toString();
  activityAnchorMismatch.processRusageSeries.activityEvents[0].endUnixMicroseconds = parseCanonicalUTCMicrosecond("2026-08-23T11:00:01.800000Z", "synthetic drift").toString();
  assert.throws(() => parseAndCorrelate(activityAnchorMismatch, queryStart, makeNDJSON([launch])), /diverged/);
  const staleLaunchIdentity = makeSeries();
  staleLaunchIdentity.processRusageSeries.processStartUnixMicroseconds = parseCanonicalUTCMicrosecond("2026-08-23T10:59:55.000000Z", "synthetic replaced process").toString();
  assert.throws(() => parseAndCorrelate(staleLaunchIdentity, queryStart, makeNDJSON([launch])), /measured process incarnation/);
  assert.throws(() => parseAndCorrelate(makeSeries(), "2026-08-23T09:59:59Z", makeNDJSON([launch])), /lookback/);

}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--self-test") return { selfTest: true };
  assert.equal(argv.length, 4, "usage: sanitize_m4_wakeup_signposts.mjs --series <path> --query-start <UTC timestamp>");
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    assert.ok(option === "--series" || option === "--query-start", `unknown option: ${option}`);
    assert.equal(options.has(option), false, `duplicate option: ${option}`);
    assert.ok(argv[index + 1]?.length > 0, `${option} requires a value`);
    options.set(option, argv[index + 1]);
  }
  assert.ok(options.has("--series") && options.has("--query-start"), "both --series and --query-start are required");
  return { selfTest: false, seriesPath: options.get("--series"), queryStart: options.get("--query-start") };
}

async function readSeriesFile(seriesPath) {
  const resolvedPath = path.resolve(seriesPath);
  let handle;
  try {
    const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK | (fsConstants.O_CLOEXEC ?? 0);
    handle = await open(resolvedPath, flags);
  } catch {
    throw new Error("series file could not be opened without following links");
  }
  try {
    const before = await handle.stat({ bigint: true });
    assert.equal(before.isFile(), true, "series path must be a regular file");
    assert.ok(before.size > 0n && before.size <= BigInt(maxSeriesBytes), "series file must contain no more than 1 MiB");

    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= maxSeriesBytes) {
      const capacity = Math.min(64 * 1024, maxSeriesBytes + 1 - totalBytes);
      const buffer = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(buffer, 0, capacity, totalBytes);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    assert.ok(totalBytes > 0 && totalBytes <= maxSeriesBytes, "series file must contain no more than 1 MiB");

    const after = await handle.stat({ bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      assert.equal(after[key], before[key], "series file changed while it was being read");
    }
    assert.equal(BigInt(totalBytes), before.size, "series file size changed while it was being read");

    let input;
    try {
      input = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
    } catch {
      throw new Error("series file is not valid UTF-8");
    }
    return JSON.parse(input);
  } catch {
    throw new Error("series file failed closed validation");
  } finally {
    await handle.close();
  }
}

async function runSeriesPathSelfTest() {
  const directory = await mkdtemp(path.join(tmpdir(), "ambient-signpost-selftest-"));
  const fifoPath = path.join(directory, "series.fifo");
  try {
    const result = spawnSync("/usr/bin/mkfifo", [fifoPath], { shell: false, timeout: 2_000 });
    assert.equal(result.status, 0, "self-test could not create its bounded FIFO fixture");
    await assert.rejects(readSeriesFile(fifoPath), /series file failed closed validation/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    await runSeriesPathSelfTest();
    console.log("wakeup-signpost sanitizer self-test: 52 positive/negative cases passed; raw records are synthetic, the FIFO is temporary, and retained output is closed");
    return;
  }
  assert.equal(process.platform, "darwin", "production signpost queries require macOS");
  const series = await readSeriesFile(options.seriesPath);
  const seriesInfo = validateSeries(series);
  const queryStartMicros = validateQueryStart(options.queryStart, seriesInfo);
  const output = await runLogQuery(seriesInfo, options.queryStart, queryStartMicros);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`wakeup-signpost sanitization failed: ${error.message}`);
  process.exitCode = 1;
});
