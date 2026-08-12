import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { Pool } from "pg";
import { POSTGRES_BRIDGE_MIGRATIONS } from "../src/bridge/postgres-migrations.js";
import { PostgresBridgeStore } from "../src/bridge/postgres-store.js";
import { BridgeSchemaMigrationError } from "../src/bridge/types.js";

const connectionString = process.env.TEST_POSTGRES_URL;

async function isolatedPool(t: TestContext): Promise<Pool> {
  assert.ok(connectionString);
  const schema = `ambient_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^ambient_test_[a-f0-9]{32}$/);
  const admin = new Pool({ connectionString, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
    max: 10,
  });
  t.after(async () => {
    await pool.end();
    // This exact, randomly generated test schema is the only cleanup target.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  return pool;
}

test(
  "PostgreSQL bridge migrations and delivery semantics hold on a real server",
  { skip: connectionString ? false : "TEST_POSTGRES_URL is not configured." },
  async (t) => {
    assert.ok(connectionString);

    await t.test("concurrent initialization is serialized and v3 delivery is fenced", async (t) => {
      const pool = await isolatedPool(t);
      const first = new PostgresBridgeStore({ connectionString }, pool);
      const second = new PostgresBridgeStore({ connectionString }, pool);
      await Promise.all([first.initialize(), second.initialize()]);
      const ledger = await pool.query<{ version: number }>(
        "SELECT version FROM ambient_bridge_schema_migrations ORDER BY version",
      );
      assert.deepEqual(ledger.rows.map(({ version }) => version), [1, 2, 3]);

      const { device } = await first.createDevice("Integration Mac");
      const command = await first.enqueue(device.deviceId, { type: "get_status" }, 120);
      const lease = await first.leaseNext(device.deviceId, 30);
      assert.equal(lease?.attemptCount, 1);
      assert.equal(lease?.protocolVersion, 2);
      assert.ok(lease?.leaseId);
      const completed = await first.complete(command.id, device.deviceId, lease.leaseId, { online: true });
      assert.equal(completed?.status, "succeeded");
      assert.deepEqual(
        await first.complete(command.id, device.deviceId, lease.leaseId, { online: true }),
        completed,
      );

      const fenced = await first.enqueue(device.deviceId, { type: "get_status" }, 120);
      const staleLease = await first.leaseNext(device.deviceId, 30);
      assert.equal(staleLease?.id, fenced.id);
      assert.ok(staleLease?.leaseId);
      await pool.query(
        "UPDATE ambient_bridge_commands SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
        [fenced.id],
      );
      assert.equal(
        await first.complete(fenced.id, device.deviceId, staleLease.leaseId, { online: false }),
        null,
      );
      const currentLease = await first.leaseNext(device.deviceId, 30);
      assert.ok(currentLease?.leaseId);
      assert.notEqual(currentLease.leaseId, staleLease.leaseId);
      assert.equal(
        await first.complete(fenced.id, device.deviceId, staleLease.leaseId, { online: false }),
        null,
      );
      assert.equal(
        (await first.complete(fenced.id, device.deviceId, currentLease.leaseId, { online: true }))?.status,
        "succeeded",
      );

      const mutation = await first.enqueue(
        device.deviceId,
        { type: "pause", requestId: "integration-request-0001" },
        120,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO ambient_bridge_commands
            (id, device_id, operation, status, created_at, expires_at,
             lease_expires_at, lease_id, request_id, protocol_version,
             attempt_count, max_attempts, result, error)
           SELECT 'bridge_forced_duplicate', device_id, operation, 'pending',
             clock_timestamp(), clock_timestamp() + INTERVAL '1 minute',
             NULL, NULL, request_id, 2, 0, 3, NULL, NULL
             FROM ambient_bridge_commands WHERE id = $1`,
          [mutation.id],
        ),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "23505"
        ),
      );
      const mutationLease = await first.leaseNext(device.deviceId, 30);
      assert.equal(mutationLease?.id, mutation.id);
      assert.ok(mutationLease?.leaseId);
      await first.complete(mutation.id, device.deviceId, mutationLease.leaseId, { applied: true });

      const retryCommand = await first.enqueue(device.deviceId, { type: "get_status" }, 120);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const retryLease = await first.leaseNext(device.deviceId, 30);
        assert.equal(retryLease?.id, retryCommand.id);
        assert.equal(retryLease?.attemptCount, attempt);
        await pool.query(
          "UPDATE ambient_bridge_commands SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
          [retryCommand.id],
        );
      }
      assert.equal(await first.leaseNext(device.deviceId, 30), null);
      const exhausted = await first.getCommand(retryCommand.id);
      assert.equal(exhausted?.status, "failed");
      assert.match(exhausted?.error ?? "", /failed after 3 lease attempts/);
    });

    await t.test("v1 and partially-upgraded data is normalized without deleting history", async (t) => {
      const pool = await isolatedPool(t);
      const v1 = POSTGRES_BRIDGE_MIGRATIONS[0];
      assert.ok(v1);
      await pool.query(v1.sql);
      await pool.query(`
        CREATE TABLE ambient_bridge_schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        )
      `);
      await pool.query(
        "INSERT INTO ambient_bridge_schema_migrations (version, name) VALUES (1, 'base_bridge_schema')",
      );
      await pool.query("ALTER TABLE ambient_bridge_commands ADD COLUMN lease_id TEXT");
      await pool.query("ALTER TABLE ambient_bridge_commands ADD COLUMN request_id TEXT");
      await pool.query(`
        INSERT INTO ambient_bridge_devices
          (device_id, display_name, token_hash, enrolled_at, last_seen_at, revoked_at)
        VALUES ('device_legacy', 'Legacy Mac', 'hash', clock_timestamp(), NULL, NULL)
      `);

      const insertLegacy = async (
        id: string,
        operation: Record<string, unknown>,
        status: string,
        requestId: string | null,
        offset: number,
      ): Promise<void> => {
        await pool.query(
          `INSERT INTO ambient_bridge_commands
            (id, device_id, operation, status, created_at, expires_at,
             lease_expires_at, result, error, lease_id, request_id)
           VALUES ($1, 'device_legacy', $2::jsonb, $3,
             clock_timestamp() + ($5 * INTERVAL '1 second'),
             clock_timestamp() + INTERVAL '1 hour',
             CASE WHEN $3 = 'leased' THEN clock_timestamp() + INTERVAL '5 minutes' ELSE NULL END,
             NULL, NULL, CASE WHEN $3 = 'leased' THEN 'lease_legacy' ELSE NULL END, $4)`,
          [id, JSON.stringify(operation), status, requestId, offset],
        );
      };
      await insertLegacy("dup_pending", { type: "pause", requestId: "duplicate-request-0001" }, "pending", null, 0);
      await insertLegacy("dup_succeeded", { type: "pause", requestId: "duplicate-request-0001" }, "succeeded", null, 1);
      await insertLegacy("legacy_leased", { type: "get_status" }, "leased", null, 2);
      await insertLegacy(
        "mismatch",
        { type: "pause", requestId: "operation-request-0001" },
        "pending",
        "column-request---0001",
        3,
      );
      await insertLegacy("invalid", { type: "pause", requestId: "short" }, "pending", null, 4);
      await insertLegacy("column_repair", { type: "pause" }, "pending", "column-canonical-0001", 5);
      await insertLegacy("nonstring", { type: "pause", requestId: 42 }, "pending", null, 6);

      const before = await pool.query<{ count: string }>("SELECT count(*) FROM ambient_bridge_commands");
      const store = new PostgresBridgeStore({ connectionString }, pool);
      await store.initialize();
      const after = await pool.query<{ count: string }>("SELECT count(*) FROM ambient_bridge_commands");
      assert.equal(after.rows[0]?.count, before.rows[0]?.count);

      const rows = await pool.query<{
        id: string;
        status: string;
        request_id: string | null;
        operation: Record<string, unknown>;
        error: string | null;
      }>("SELECT id, status, request_id, operation, error FROM ambient_bridge_commands ORDER BY id");
      const byId = new Map(rows.rows.map((row) => [row.id, row]));
      assert.equal(byId.get("dup_succeeded")?.request_id, "duplicate-request-0001");
      assert.equal(byId.get("dup_pending")?.request_id, null);
      assert.equal(byId.get("dup_pending")?.status, "failed");
      assert.equal(byId.get("legacy_leased")?.status, "failed");
      assert.match(byId.get("legacy_leased")?.error ?? "", /protocol v2 upgrade/);
      assert.equal(byId.get("mismatch")?.status, "failed");
      assert.equal(byId.get("mismatch")?.request_id, null);
      assert.equal(byId.get("invalid")?.status, "failed");
      assert.equal(byId.get("invalid")?.request_id, null);
      assert.equal(byId.get("nonstring")?.status, "failed");
      assert.equal(byId.get("nonstring")?.request_id, null);
      assert.equal(byId.get("column_repair")?.status, "pending");
      assert.equal(byId.get("column_repair")?.request_id, "column-canonical-0001");
      assert.equal(byId.get("column_repair")?.operation.requestId, "column-canonical-0001");
    });

    await t.test("future versions and failed migrations remain fail-closed", async (t) => {
      const futurePool = await isolatedPool(t);
      await futurePool.query(`
        CREATE TABLE ambient_bridge_schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        )
      `);
      await futurePool.query(
        "INSERT INTO ambient_bridge_schema_migrations (version, name) VALUES (99, 'future')",
      );
      const future = new PostgresBridgeStore({ connectionString }, futurePool);
      await assert.rejects(future.initialize(), /schema version 99 is newer/);

      const malformedPool = await isolatedPool(t);
      await malformedPool.query(`
        CREATE TABLE ambient_bridge_schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        )
      `);
      await malformedPool.query(
        "INSERT INTO ambient_bridge_schema_migrations (version, name) VALUES (1, 'base_bridge_schema')",
      );
      const malformed = new PostgresBridgeStore({ connectionString }, malformedPool);
      await assert.rejects(malformed.initialize(), BridgeSchemaMigrationError);
      const ledger = await malformedPool.query<{ version: number }>(
        "SELECT version FROM ambient_bridge_schema_migrations ORDER BY version",
      );
      assert.deepEqual(ledger.rows.map(({ version }) => version), [1]);
      await assert.rejects(malformed.initialize(), BridgeSchemaMigrationError);
    });
  },
);
