import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  POSTGRES_BRIDGE_MIGRATIONS,
  POSTGRES_BRIDGE_MIGRATION_LOCK,
  migratePostgresBridge,
} from "../src/bridge/postgres-migrations.js";
import { PostgresBridgeStore } from "../src/bridge/postgres-store.js";
import { BridgeSchemaMigrationError } from "../src/bridge/types.js";

function fakePool(client: PoolClient, onConnect?: () => void): Pool {
  return {
    async connect() {
      onConnect?.();
      return client;
    },
  } as unknown as Pool;
}

test("Postgres initialization uses one locked transaction and caches concurrent success", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let connectCount = 0;
  let releaseCount = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, ...(values === undefined ? {} : { values }) });
      if (text.includes("SELECT version FROM ambient_bridge_schema_migrations")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { releaseCount += 1; },
  } as unknown as PoolClient;
  const store = new PostgresBridgeStore(
    { connectionString: "postgresql://unused" },
    fakePool(client, () => { connectCount += 1; }),
  );

  const first = store.initialize();
  const second = store.initialize();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(connectCount, 1);
  assert.equal(releaseCount, 1);
  assert.deepEqual(calls[0]?.text, "BEGIN");
  const lockIndex = calls.findIndex(({ text }) => text.includes("pg_advisory_xact_lock"));
  const ledgerIndex = calls.findIndex(({ text }) => text.includes("CREATE TABLE IF NOT EXISTS ambient_bridge_schema_migrations"));
  assert.ok(lockIndex > 0 && lockIndex < ledgerIndex);
  assert.deepEqual(calls[lockIndex]?.values, [...POSTGRES_BRIDGE_MIGRATION_LOCK]);
  assert.deepEqual(
    calls.filter(({ text }) => text.includes("INSERT INTO ambient_bridge_schema_migrations"))
      .map(({ values }) => values?.[0]),
    [1, 2, 3],
  );
  assert.equal(calls.at(-1)?.text, "COMMIT");
});

test("Postgres initialization caches a typed failure and never creates a retry storm", async () => {
  let connectCount = 0;
  let releaseCount = 0;
  let rollbackCount = 0;
  const client = {
    async query(text: string) {
      if (text.includes("CREATE TABLE IF NOT EXISTS ambient_bridge_schema_migrations")) {
        throw new Error("temporary database startup failure");
      }
      if (text === "ROLLBACK") rollbackCount += 1;
      return { rows: [], rowCount: 0 };
    },
    release() { releaseCount += 1; },
  } as unknown as PoolClient;
  const store = new PostgresBridgeStore(
    { connectionString: "postgresql://unused" },
    fakePool(client, () => { connectCount += 1; }),
  );

  const first = store.initialize();
  await assert.rejects(first, BridgeSchemaMigrationError);
  assert.equal(store.initialize(), first);
  await assert.rejects(store.getDevice("device_test"), BridgeSchemaMigrationError);
  assert.equal(connectCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(rollbackCount, 1);
});

test("Postgres migration rejects a newer database version and rolls back", async () => {
  const calls: string[] = [];
  const client = {
    async query(text: string) {
      calls.push(text);
      if (text.includes("SELECT version FROM ambient_bridge_schema_migrations")) {
        return { rows: [{ version: 99 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;

  await assert.rejects(
    migratePostgresBridge(client),
    /schema version 99 is newer than supported version 3/,
  );
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.some((text) => text.includes("INSERT INTO ambient_bridge_schema_migrations")), false);
});

test("migration and runtime SQL enforce v2 fencing, bounded attempts, and wall-clock time", async () => {
  const migrations = POSTGRES_BRIDGE_MIGRATIONS.map(({ sql }) => sql).join("\n");
  const runtime = await readFile(new URL("../src/bridge/postgres-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(`${migrations}\n${runtime}`, /\bNOW\s*\(/i);
  assert.match(migrations, /CREATE UNIQUE INDEX[\s\S]*\(device_id, request_id\)[\s\S]*WHERE request_id IS NOT NULL/i);
  assert.match(migrations, /row_number\(\)[\s\S]*WHEN 'succeeded' THEN 0[\s\S]*WHEN 'failed' THEN 1/i);
  assert.match(migrations, /attempt_count >= 0 AND attempt_count <= max_attempts/i);
  assert.match(runtime, /WITH candidate AS[\s\S]*FOR UPDATE SKIP LOCKED[\s\S]*attempt_count = command\.attempt_count \+ 1/i);
  assert.match(runtime, /attempt_count < command\.max_attempts/i);
  assert.match(runtime, /protocol_version = \$4/i);
});
