#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "script/macos_media_capability_probe.m");
const expectedSourceSHA256 = "6e204a8ab2eace6769a7398c8af7bd25cc61a08460c86b1c3173df264ea0f04b";

const outputKeys = [
  "schemaVersion",
  "scope",
  "hevcCodecTypeHardwareDecodeSupported",
  "metalDeviceAvailable",
  "decoderSessions",
  "gpuTimeNanoseconds",
  "gpuUtilizationPercent",
  "qualification",
];
const canonicalOutputPattern = /^\{"schemaVersion":1,"scope":"host-capability-only","hevcCodecTypeHardwareDecodeSupported":(?:true|false),"metalDeviceAvailable":(?:true|false),"decoderSessions":null,"gpuTimeNanoseconds":null,"gpuUtilizationPercent":null,"qualification":"capability-only"\}$/;

function exactKeys(value, keys, at) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${at} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${at} has unexpected or missing keys`);
}

function validate(value) {
  exactKeys(value, outputKeys, "media capability output");
  assert.equal(value.schemaVersion, 1, "schemaVersion must be 1");
  assert.equal(value.scope, "host-capability-only", "scope must remain capability-only");
  assert.equal(typeof value.hevcCodecTypeHardwareDecodeSupported, "boolean", "HEVC availability must be boolean");
  assert.equal(typeof value.metalDeviceAvailable, "boolean", "Metal availability must be boolean");
  assert.equal(value.decoderSessions, null, "decoder sessions are not measured by this probe");
  assert.equal(value.gpuTimeNanoseconds, null, "GPU time is not measured by this probe");
  assert.equal(value.gpuUtilizationPercent, null, "GPU utilization is not measured by this probe");
  assert.equal(value.qualification, "capability-only", "the probe cannot claim qualification");
  return value;
}

function parseAndValidate(input) {
  assert.match(input, canonicalOutputPattern, "media capability output must use the exact canonical JSON encoding");
  return validate(JSON.parse(input));
}

function occurrences(source, token) {
  return source.split(token).length - 1;
}

function validateSourceContract(source) {
  const imports = [...source.matchAll(/^#import <([^>]+)>$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [
    "CoreMedia/CoreMedia.h",
    "Foundation/Foundation.h",
    "Metal/Metal.h",
    "VideoToolbox/VideoToolbox.h",
  ], "probe imports must remain the exact public framework headers");
  assert.equal(occurrences(source, "VTIsHardwareDecodeSupported("), 1, "probe must make exactly one HEVC capability query");
  assert.equal(
    occurrences(source, "VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)"),
    1,
    "probe capability query must remain bound to the HEVC codec type",
  );
  assert.deepEqual(
    [...source.matchAll(/\bkCMVideoCodecType_[A-Za-z0-9_]+\b/g)].map((match) => match[0]),
    ["kCMVideoCodecType_HEVC"],
    "probe must not query or label another media codec type",
  );
  assert.equal(occurrences(source, "MTLCopyAllDevices("), 1, "probe must make exactly one non-switching Metal capability query");
  assert.match(source, /argc != 1/, "probe must reject every argument");
  for (const key of outputKeys) assert.equal(occurrences(source, `\\\"${key}\\\"`), 1, `probe must emit ${key} exactly once`);

  const prohibitedTokens = [
    "MTLCreateSystemDefaultDevice",
    "MTLCopyAllDevicesWithObserver",
    "MTLRemoveDeviceObserver",
    "newCommandQueue",
    "commandBuffer",
    "VTDecompressionSessionCreate",
    "VTDecompressionSessionDecodeFrame",
    "AVPlayer",
    ".name",
    ".registryID",
    "proc_pid",
    "sysctl",
    "IORegistry",
  ];
  for (const token of prohibitedTokens) assert.equal(source.includes(token), false, `probe source contains prohibited token ${token}`);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    expectedSourceSHA256,
    "probe source changed outside the independently reviewed capability-only boundary",
  );
}

const makeValid = (overrides = {}) => ({
  schemaVersion: 1,
  scope: "host-capability-only",
  hevcCodecTypeHardwareDecodeSupported: true,
  metalDeviceAvailable: true,
  decoderSessions: null,
  gpuTimeNanoseconds: null,
  gpuUtilizationPercent: null,
  qualification: "capability-only",
  ...overrides,
});

function runSelfTest(source) {
  validateSourceContract(source);
  parseAndValidate(JSON.stringify(makeValid()));
  parseAndValidate(JSON.stringify(makeValid({ hevcCodecTypeHardwareDecodeSupported: false, metalDeviceAvailable: false })));
  parseAndValidate(JSON.stringify(makeValid({ hevcCodecTypeHardwareDecodeSupported: true, metalDeviceAvailable: false })));
  parseAndValidate(JSON.stringify(makeValid({ hevcCodecTypeHardwareDecodeSupported: false, metalDeviceAvailable: true })));

  const tamperCases = [
    (value) => { delete value.metalDeviceAvailable; },
    (value) => { value.extra = true; },
    (value) => { value.schemaVersion = 2; },
    (value) => { value.scope = "runtime-measurement"; },
    (value) => { value.hevcCodecTypeHardwareDecodeSupported = 1; },
    (value) => { value.metalDeviceAvailable = "yes"; },
    (value) => { value.decoderSessions = 0; },
    (value) => { value.gpuTimeNanoseconds = 0; },
    (value) => { value.gpuUtilizationPercent = 0; },
    (value) => { value.qualification = "qualified"; },
    (value) => { value.measurementCoverage = { decoder: "measured" }; },
    (value) => { value.deviceName = "prohibited"; },
    (value) => { value.registryID = "1"; },
    (value) => { value.pid = 1; },
    (value) => { value.path = "/prohibited"; },
    (value) => { value.hostIdentifier = "prohibited"; },
  ];

  for (const tamper of tamperCases) {
    const candidate = structuredClone(makeValid());
    tamper(candidate);
    assert.throws(() => validate(candidate));
  }
  const canonical = JSON.stringify(makeValid());
  const rawTamperCases = [
    canonical.replace('"metalDeviceAvailable":true', '"metalDeviceAvailable":false,"metalDeviceAvailable":true'),
    canonical.replace('{"schemaVersion":1', '{ "schemaVersion":1'),
    canonical.replace('"schemaVersion":1', '"schemaVersion":1.0'),
    canonical.replace(',"qualification"', ',\n"qualification"'),
  ];
  for (const candidate of rawTamperCases) assert.throws(() => parseAndValidate(candidate));
  const sourceTamperCases = [
    (value) => value.replace("MTLCopyAllDevices()", "MTLCreateSystemDefaultDevice()"),
    (value) => `${value}\nVTDecompressionSessionCreate`,
    (value) => `${value}\nnewCommandQueue`,
    (value) => `${value}\ndevices.firstObject.name`,
    (value) => value.replace("MTLCopyAllDevices();", "MTLCopyAllDevices(); MTLCopyAllDevices();"),
    (value) => value.replace("#import <Metal/Metal.h>", "#import <AVFoundation/AVFoundation.h>\n#import <Metal/Metal.h>"),
    (value) => value.replace("kCMVideoCodecType_HEVC", "kCMVideoCodecType_H264"),
    (value) => value.replace("#include <stdio.h>", "#include <stdio.h>\n#include <stdlib.h>"),
  ];
  for (const tamper of sourceTamperCases) assert.throws(() => validateSourceContract(tamper(source)));
  console.log(`macOS media capability validator self-test: 4 positive and ${tamperCases.length + rawTamperCases.length + sourceTamperCases.length} fail-closed cases passed`);
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(Buffer.byteLength(input, "utf8") <= 4096, "media capability output exceeds 4096 bytes");
  }
  return input;
}

async function main() {
  const source = await readFile(sourcePath, "utf8");
  if (process.argv[2] === "--self-test") {
    assert.equal(process.argv.length, 3, "--self-test accepts no additional arguments");
    runSelfTest(source);
    return;
  }
  assert.equal(process.argv.length, 2, "usage: validate_macos_media_capability_probe.mjs [--self-test]");
  validateSourceContract(source);
  const input = (await readStdin()).trim();
  assert.ok(input.length > 0, "media capability output is empty");
  parseAndValidate(input);
  console.log("macOS media capability output valid: capability-only; decoder and GPU runtime metrics remain null");
}

main().catch((error) => {
  console.error(`macOS media capability validation failed: ${error.message}`);
  process.exitCode = 1;
});
