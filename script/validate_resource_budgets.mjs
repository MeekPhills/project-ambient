#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "schemas/resource-budgets/v1/resource-budget.schema.json");
const fixturePath = path.join(root, "fixtures/resource-budgets/v1/base-m4-mac-mini.json");
const coverageKeys = ["cpu", "rss", "wakeups", "network", "decoder", "gpu", "framePacing", "storageChurn", "displayTopology", "pressure", "soak"];
const budgetKeys = ["staticSettled", "settingsCatalog", "dualDisplay8k", "sameSourceVideo", "chat", "soakHours"];
const exactKeys = (value, keys, at) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${at}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${at}: unexpected or missing keys`);
};

function validate(fixture) {
  exactKeys(fixture, ["schemaVersion", "fixtureId", "claimScope", "qualificationStatus", "referenceMachine", "displayFixture", "budgets", "measurementCoverage", "evidence"], "fixture");
  assert.equal(fixture.schemaVersion, 1, "fixture.schemaVersion must be 1");
  assert.equal(fixture.fixtureId, "base-2024-m4-mac-mini-16gb-256gb", "fixture ID must be canonical");
  assert.equal(fixture.claimScope, "contract_fixture", "fixtures cannot claim a shipped build");
  assert.ok(["planned", "partial_evidence", "qualified"].includes(fixture.qualificationStatus), "invalid qualification status");
  exactKeys(fixture.referenceMachine, ["chip", "memoryGiB", "storageGiB"], "referenceMachine");
  assert.equal(fixture.referenceMachine.chip, "Apple M4", "reference chip must be Apple M4");
  assert.equal(fixture.referenceMachine.memoryGiB, 16, "reference memory must be 16 GiB");
  assert.equal(fixture.referenceMachine.storageGiB, 256, "reference storage must be 256 GiB");
  exactKeys(fixture.displayFixture, ["required", "hdr"], "displayFixture");
  assert.equal(fixture.displayFixture.required, true, "dual-display fixture is mandatory");
  assert.equal(fixture.displayFixture.hdr, "off", "fixture requires HDR off");
  exactKeys(fixture.budgets, budgetKeys, "budgets");
  const staticBudget = fixture.budgets.staticSettled;
  assert.equal(staticBudget.cpuPercentP95Max, 0.2, "static CPU ceiling drifted");
  assert.equal(staticBudget.wakeupsPerMinuteMax, 2, "static wakeup ceiling drifted");
  assert.equal(staticBudget.rssMiBMax, 40, "static RSS ceiling drifted");
  assert.equal(staticBudget.continuousRenderer, false, "static mode cannot retain a renderer");
  assert.equal(staticBudget.decoder, false, "static mode cannot retain a decoder");
  assert.equal(staticBudget.network, false, "static mode cannot retain network activity");
  assert.equal(fixture.budgets.settingsCatalog.items, 1000, "catalog fixture must contain 1,000 items");
  assert.equal(fixture.budgets.settingsCatalog.rssMiBP95Max, 180, "settings RSS ceiling drifted");
  assert.equal(fixture.budgets.dualDisplay8k.rssMiBTransientMax, 350, "8K ceiling drifted");
  assert.equal(fixture.budgets.dualDisplay8k.returnToSettledSecondsMax, 15, "settle ceiling drifted");
  assert.equal(fixture.budgets.sameSourceVideo.decoderSessionsMax, 1, "same-source video must share one decoder");
  assert.equal(fixture.budgets.chat.incrementalRssMiBMax, 40, "chat memory ceiling drifted");
  assert.equal(fixture.budgets.chat.listenerAfterClose, false, "chat listener must stop on close");
  assert.ok([48, 72].includes(fixture.budgets.soakHours), "soak must be 48 or 72 hours");
  exactKeys(fixture.measurementCoverage, coverageKeys, "measurementCoverage");
  for (const key of coverageKeys) assert.ok(["unmeasured", "partial", "measured"].includes(fixture.measurementCoverage[key]), `measurementCoverage.${key}: invalid state`);
  if (fixture.qualificationStatus === "qualified") assert.ok(coverageKeys.every((key) => fixture.measurementCoverage[key] === "measured"), "qualified fixture requires every metric measured");
  exactKeys(fixture.evidence, ["source", "verifiedAt"], "evidence");
  assert.ok(typeof fixture.evidence.source === "string" && fixture.evidence.source.length >= 12, "evidence.source required");
  assert.ok(!Number.isNaN(Date.parse(fixture.evidence.verifiedAt)), "evidence.verifiedAt must be ISO date-time");
}

const clone = (value) => structuredClone(value);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.equal(schema.properties.schemaVersion.const, 1, "schema must bind v1");
validate(fixture);
const tamperCases = [
  (x) => { x.fixtureId = "other"; }, (x) => { x.claimScope = "shipped_build"; },
  (x) => { x.referenceMachine.memoryGiB = 32; }, (x) => { delete x.measurementCoverage.wakeups; },
  (x) => { x.measurementCoverage.wakeups = "measured"; x.qualificationStatus = "qualified"; },
  (x) => { x.budgets.staticSettled.cpuPercentP95Max = 1; }, (x) => { x.budgets.sameSourceVideo.decoderSessionsMax = 2; },
  (x) => { x.budgets.chat.listenerAfterClose = true; }, (x) => { x.displayFixture.required = false; },
  (x) => { x.trackerCredit = 1; }
];
for (const tamper of tamperCases) { const candidate = clone(fixture); tamper(candidate); assert.throws(() => validate(candidate)); }
console.log(`Resource-budget contract valid: schema v1, base M4 fixture, ${tamperCases.length} negative/fail-closed checks passed.`);
