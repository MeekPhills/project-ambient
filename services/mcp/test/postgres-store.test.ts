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
import { readBridgeMigrationConfig } from "../src/bridge/migration-config.js";
import { BridgeSchemaMigrationError } from "../src/bridge/types.js";

const ledger = POSTGRES_BRIDGE_MIGRATIONS.map(({ version, name }) => ({ version, name }));
const relations = [
  "ambient_bridge_commands",
  "ambient_bridge_devices",
  "ambient_bridge_rate_limit_state",
  "ambient_bridge_rate_limits",
  "ambient_bridge_schema_migrations",
].map((relname) => ({ relname }));

const columns = [
  ["ambient_bridge_commands", "id", "text", true],
  ["ambient_bridge_commands", "device_id", "text", true],
  ["ambient_bridge_commands", "operation", "jsonb", true],
  ["ambient_bridge_commands", "status", "text", true],
  ["ambient_bridge_commands", "created_at", "timestamp with time zone", true],
  ["ambient_bridge_commands", "expires_at", "timestamp with time zone", true],
  ["ambient_bridge_commands", "lease_expires_at", "timestamp with time zone", false],
  ["ambient_bridge_commands", "result", "jsonb", false],
  ["ambient_bridge_commands", "error", "text", false],
  ["ambient_bridge_commands", "lease_id", "text", false],
  ["ambient_bridge_commands", "request_id", "text", false],
  ["ambient_bridge_commands", "protocol_version", "smallint", true],
  ["ambient_bridge_commands", "attempt_count", "integer", true],
  ["ambient_bridge_commands", "max_attempts", "integer", true],
  ["ambient_bridge_devices", "device_id", "text", true],
  ["ambient_bridge_devices", "display_name", "text", true],
  ["ambient_bridge_devices", "token_hash", "text", true],
  ["ambient_bridge_devices", "enrolled_at", "timestamp with time zone", true],
  ["ambient_bridge_devices", "last_seen_at", "timestamp with time zone", false],
  ["ambient_bridge_devices", "revoked_at", "timestamp with time zone", false],
  ["ambient_bridge_rate_limit_state", "scope", "text", true],
  ["ambient_bridge_rate_limit_state", "active_keys", "integer", true],
  ["ambient_bridge_rate_limits", "scope", "text", true],
  ["ambient_bridge_rate_limits", "key_hash", "text", true],
  ["ambient_bridge_rate_limits", "total_hits", "integer", true],
  ["ambient_bridge_rate_limits", "reset_at", "timestamp with time zone", true],
  ["ambient_bridge_schema_migrations", "version", "integer", true],
  ["ambient_bridge_schema_migrations", "name", "text", true],
  ["ambient_bridge_schema_migrations", "applied_at", "timestamp with time zone", true],
].map(([relation, column, data_type, not_null]) => ({ relation, column, data_type, not_null }));
const constraints = [
  "ambient_bridge_commands_attempt_count_valid",
  "ambient_bridge_commands_device_id_fkey",
  "ambient_bridge_commands_lease_id_valid",
  "ambient_bridge_commands_lease_shape_valid",
  "ambient_bridge_commands_max_attempts_valid",
  "ambient_bridge_commands_pkey",
  "ambient_bridge_commands_protocol_v2",
  "ambient_bridge_commands_request_id_valid",
  "ambient_bridge_commands_status_check",
  "ambient_bridge_devices_pkey",
  "ambient_bridge_rate_limit_state_active_keys_check",
  "ambient_bridge_rate_limit_state_pkey",
  "ambient_bridge_rate_limit_state_scope_check",
  "ambient_bridge_rate_limits_key_hash_check",
  "ambient_bridge_rate_limits_pkey",
  "ambient_bridge_rate_limits_scope_check",
  "ambient_bridge_rate_limits_total_hits_check",
  "ambient_bridge_schema_migrations_pkey",
].map((conname) => ({
  conname,
  relation: conname.startsWith("ambient_bridge_commands")
    ? "ambient_bridge_commands"
    : conname.startsWith("ambient_bridge_devices")
      ? "ambient_bridge_devices"
      : conname.startsWith("ambient_bridge_rate_limit_state")
        ? "ambient_bridge_rate_limit_state"
        : conname.startsWith("ambient_bridge_rate_limits")
          ? "ambient_bridge_rate_limits"
          : "ambient_bridge_schema_migrations",
  contype: conname.endsWith("_pkey") ? "p" : conname.endsWith("_fkey") ? "f" : "c",
  validated: true,
  definition: conname === "ambient_bridge_commands_device_id_fkey"
    ? "FOREIGN KEY (device_id) REFERENCES ambient_private.ambient_bridge_devices(device_id)"
    : conname === "ambient_bridge_commands_pkey"
      ? "PRIMARY KEY (id)"
      : conname === "ambient_bridge_devices_pkey"
        ? "PRIMARY KEY (device_id)"
        : conname === "ambient_bridge_rate_limit_state_pkey"
          ? "PRIMARY KEY (scope)"
          : conname === "ambient_bridge_rate_limits_pkey"
            ? "PRIMARY KEY (scope, key_hash)"
            : conname === "ambient_bridge_schema_migrations_pkey"
              ? "PRIMARY KEY (version)"
              : conname.includes("attempt_count")
                ? "CHECK (attempt_count >= 0 AND attempt_count <= max_attempts)"
                : conname.includes("max_attempts")
                  ? "CHECK (max_attempts >= 1 AND max_attempts <= 10)"
                  : conname.includes("lease_id_valid")
                    ? "CHECK (lease_id IS NULL OR char_length(lease_id) >= 1 AND char_length(lease_id) <= 128)"
                    : conname.includes("lease_shape")
                      ? "CHECK (status = 'leased' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL OR status <> 'leased' AND lease_expires_at IS NULL)"
                      : conname.includes("protocol_v2")
                        ? "CHECK (protocol_version = 2)"
                        : conname.includes("request_id_valid")
                          ? "CHECK (request_id IS NULL OR request_id = btrim(request_id) AND char_length(request_id) >= 16 AND char_length(request_id) <= 128)"
                          : conname.includes("status_check")
                            ? "CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'expired'))"
                            : conname.includes("active_keys")
                              ? "CHECK (active_keys >= 0 AND active_keys <= 100000)"
                              : conname.includes("scope_check")
                                ? "CHECK (scope IN ('mcp-ingress', 'mcp-authorized', 'ingress', 'admin', 'device-poll', 'device-result'))"
                                : conname.includes("key_hash")
                                  ? "CHECK (char_length(key_hash) >= 32 AND char_length(key_hash) <= 128)"
                                  : "CHECK (total_hits >= 1)",
}));
const indexes = [
  {
    index_name: "ambient_bridge_commands_delivery_idx",
    relation: "ambient_bridge_commands",
    valid: true,
    unique_index: false,
    predicate: null,
    definition: "CREATE INDEX ON ambient_bridge_commands (device_id, status, created_at, id)",
  },
  {
    index_name: "ambient_bridge_commands_request_unique_idx",
    relation: "ambient_bridge_commands",
    valid: true,
    unique_index: true,
    predicate: "request_id IS NOT NULL",
    definition: "CREATE UNIQUE INDEX ON ambient_bridge_commands (device_id, request_id)",
  },
  {
    index_name: "ambient_bridge_rate_limits_reset_idx",
    relation: "ambient_bridge_rate_limits",
    valid: true,
    unique_index: false,
    predicate: null,
    definition: "CREATE INDEX ON ambient_bridge_rate_limits (scope, reset_at)",
  },
];

function fakePool(client: PoolClient, onConnect?: () => void): Pool {
  return {
    async connect() {
      onConnect?.();
      return client;
    },
  } as unknown as Pool;
}

function verificationClient(options?: {
  ledger?: ReadonlyArray<{ version: number; name: string }>;
  relations?: ReadonlyArray<{ relname: string }>;
}): PoolClient {
  return {
    async query(text: string) {
      if (text.includes('FROM "ambient_private"."ambient_bridge_schema_migrations"')) {
        return { rows: options?.ledger ?? ledger, rowCount: options?.ledger?.length ?? ledger.length };
      }
      if (text.includes("namespace.nspname = 'public'")) return { rows: [], rowCount: 0 };
      if (text.includes("FROM pg_catalog.pg_attribute")) return { rows: columns, rowCount: columns.length };
      if (text.includes("FROM pg_catalog.pg_constraint")) return { rows: constraints, rowCount: constraints.length };
      if (text.includes("FROM pg_catalog.pg_index")) return { rows: indexes, rowCount: indexes.length };
      if (text.includes("FROM pg_catalog.pg_roles AS role_record")) {
        return { rows: [{
          rolname: "ambient_runtime_test",
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolinherit: false,
          rolcanlogin: true,
          memberships: 0,
        }], rowCount: 1 };
      }
      if (text.includes("SELECT current_database()")) {
        return { rows: [{ database_name: "ambient_test" }], rowCount: 1 };
      }
      if (text.includes("AS owns_relation")) {
        return { rows: [{
          owns_relation: false,
          database_create: false,
          schema_create: false,
          has_connect: true,
          has_schema_usage: true,
          has_ledger_select: true,
          has_ledger_write: false,
          has_devices_dml: true,
          has_devices_excess: false,
          has_commands_dml: true,
          has_commands_excess: false,
          has_rate_limits_dml: true,
          has_rate_limits_excess: false,
          has_rate_state_dml: true,
          has_rate_state_excess: false,
        }], rowCount: 1 };
      }
      if (text.includes("FROM pg_catalog.pg_class")) {
        return { rows: options?.relations ?? relations, rowCount: options?.relations?.length ?? relations.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  } as unknown as PoolClient;
}

test("Postgres runtime initialization is read-only, exact, and caches concurrent success", async () => {
  const calls: string[] = [];
  let connectCount = 0;
  const client = verificationClient();
  const originalQuery = client.query.bind(client);
  client.query = (async (text: string, values?: unknown[]) => {
    calls.push(text);
    return originalQuery(text, values);
  }) as typeof client.query;
  const store = new PostgresBridgeStore(
    { connectionString: "postgresql://unused" },
    fakePool(client, () => { connectCount += 1; }),
  );

  const first = store.initialize();
  assert.equal(store.initialize(), first);
  await Promise.all([first, store.initialize()]);
  assert.equal(connectCount, 1);
  assert.equal(calls.some((sql) => /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REVOKE|GRANT)\b/i.test(sql)), false);
  assert.equal(calls.some((sql) => sql.includes("pg_advisory")), false);
});

test("Postgres runtime caches missing, outdated, future, and malformed schema failures", async () => {
  for (const [name, configured, pattern] of [
    ["missing", { ledger: [] }, /version 0 is outdated/],
    ["outdated", { ledger: ledger.slice(0, 3) }, /version 3 is outdated/],
    ["future", { ledger: [...ledger, { version: 99, name: "future" }] }, /newer than supported/],
    ["name mismatch", { ledger: ledger.map((row, index) => index === 1 ? { ...row, name: "wrong" } : row) }, /unexpected name/],
    ["relation missing", { relations: relations.slice(0, 4) }, /missing required relations/],
  ] as const) {
    let connectCount = 0;
    const store = new PostgresBridgeStore(
      { connectionString: "postgresql://unused" },
      fakePool(verificationClient(configured), () => { connectCount += 1; }),
    );
    const first = store.initialize();
    await assert.rejects(first, pattern, name);
    assert.equal(store.initialize(), first);
    await assert.rejects(store.getDevice("device_test"), BridgeSchemaMigrationError);
    assert.equal(connectCount, 1);
  }
});

test("Postgres migration uses one locked transaction, a private ledger, and revokes exposed access", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, ...(values === undefined ? {} : { values }) });
      if (text.includes("FROM pg_catalog.pg_roles")) return { rows: [], rowCount: 0 };
      if (text.includes("namespace.nspname = 'public'")) return { rows: [], rowCount: 0 };
      if (text.includes("FROM pg_catalog.pg_attribute")) return { rows: columns, rowCount: columns.length };
      if (text.includes("FROM pg_catalog.pg_constraint")) return { rows: constraints, rowCount: constraints.length };
      if (text.includes("FROM pg_catalog.pg_index")) return { rows: indexes, rowCount: indexes.length };
      if (text.includes("FROM pg_catalog.pg_class")) {
        const schema = values?.[0];
        if (schema === "ambient_private" && calls.some(({ text: sql }) => sql.includes("INSERT INTO \"ambient_private\".\"ambient_bridge_schema_migrations\""))) {
          return { rows: relations, rowCount: relations.length };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM "ambient_private"."ambient_bridge_schema_migrations"')) {
        const migrated = calls.filter(({ text: sql }) => sql.includes("INSERT INTO \"ambient_private\".\"ambient_bridge_schema_migrations\""));
        return migrated.length > 0 ? { rows: ledger, rowCount: ledger.length } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;

  await migratePostgresBridge(client);
  assert.equal(calls[0]?.text, "BEGIN");
  const lockIndex = calls.findIndex(({ text }) => text.includes("pg_advisory_xact_lock"));
  const schemaIndex = calls.findIndex(({ text }) => text.includes('CREATE SCHEMA IF NOT EXISTS "ambient_private"'));
  assert.ok(lockIndex > 0 && lockIndex < schemaIndex);
  assert.deepEqual(calls[lockIndex]?.values, [...POSTGRES_BRIDGE_MIGRATION_LOCK]);
  assert.deepEqual(
    calls.filter(({ text }) => text.includes('INSERT INTO "ambient_private"."ambient_bridge_schema_migrations"'))
      .map(({ values }) => values?.[0]),
    [1, 2, 3, 4],
  );
  assert.ok(calls.filter(({ text }) => text.includes("REVOKE ALL ON ALL TABLES")).length >= 2);
  assert.equal(calls.at(-1)?.text, "COMMIT");
});

test("migration and runtime SQL are private-qualified and preserve delivery invariants", async () => {
  const migrations = POSTGRES_BRIDGE_MIGRATIONS.map(({ sql }) => sql).join("\n");
  const runtime = await readFile(new URL("../src/bridge/postgres-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(`${migrations}\n${runtime}`, /\bNOW\s*\(/i);
  assert.doesNotMatch(
    migrations,
    /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"ambient_private"\./i,
  );
  assert.match(migrations, /CREATE UNIQUE INDEX[\s\S]*\(device_id, request_id\)[\s\S]*WHERE request_id IS NOT NULL/i);
  assert.match(migrations, /row_number\(\)[\s\S]*WHEN 'succeeded' THEN 0[\s\S]*WHEN 'failed' THEN 1/i);
  assert.match(migrations, /attempt_count >= 0 AND attempt_count <= max_attempts/i);
  assert.match(runtime, /WITH candidate AS[\s\S]*FOR UPDATE SKIP LOCKED[\s\S]*attempt_count = command\.attempt_count \+ 1/i);
  assert.match(runtime, /attempt_count < command\.max_attempts/i);
  assert.match(runtime, /protocol_version = \$4/i);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "ambient_private"\."ambient_bridge_rate_limits"/i);
  assert.match(
    migrations,
    /"ambient_bridge_rate_limits_reset_idx"\s+ON "ambient_private"\."ambient_bridge_rate_limits"/i,
  );
  assert.match(migrations, /PRIMARY KEY \(scope, key_hash\)/i);
  for (const scope of ["mcp-ingress", "mcp-authorized", "ingress", "admin", "device-poll", "device-result"]) {
    assert.match(migrations, new RegExp(`'${scope}'`));
  }
  assert.match(runtime, /SET LOCAL lock_timeout = '1s'/i);
  assert.match(runtime, /SET LOCAL statement_timeout = '3s'/i);
  const incrementSql = runtime.slice(
    runtime.indexOf("async incrementRateLimit"),
    runtime.indexOf("async decrementRateLimit"),
  );
  const fastPathIndex = incrementSql.indexOf("const fastPath");
  const keyLockIndex = incrementSql.indexOf("pg_advisory_xact_lock");
  const concurrentRecheckIndex = incrementSql.indexOf("const concurrent");
  const scopeLockIndex = incrementSql.indexOf("SELECT active_keys");
  assert.ok(
    fastPathIndex >= 0
      && keyLockIndex > fastPathIndex
      && concurrentRecheckIndex > keyLockIndex
      && scopeLockIndex > concurrentRecheckIndex,
    "a same-key first-hit race must be rechecked under a per-key lock before taking the scope-capacity lock",
  );
  assert.match(incrementSql, /JSON\.stringify\(\[scope, keyHash\]\)/);
  assert.match(runtime, /expires_at > clock_timestamp\(\) \+ \(\$2 \* INTERVAL '1 second'\)/i);
  const unqualified = /\b(?:FROM|JOIN|UPDATE|INTO|TABLE|REFERENCES)\s+(?!"ambient_private"\."|\(|candidate\b|classified\b|ranked\b|resolved\b|pg_catalog\.)ambient_bridge_/gi;
  assert.doesNotMatch(`${migrations}\n${runtime}`, unqualified);
});

test("migration CLI rejects malformed and transaction-pooler URLs without exposing credentials", () => {
  for (const [url, expected] of [
    ["postgresql://ambient:private-password@[invalid", /valid PostgreSQL URL/],
    ["postgresql://ambient:private-password@db.example.com:6543/postgres", /transaction-pooler port 6543/],
  ] as const) {
    let message = "";
    assert.throws(() => readBridgeMigrationConfig({
      MIGRATION_DATABASE_URL: url,
      AMBIENT_RUNTIME_DB_ROLE: "ambient_runtime",
    }), (error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
      return expected.test(message);
    });
    assert.doesNotMatch(message, /private-password|postgresql:\/\//);
  }
});
