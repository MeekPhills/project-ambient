import { timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool, type PoolClient } from "pg";
import type {
  BridgeCommand,
  BridgeDevice,
  BridgeOperation,
  BridgeStore,
} from "./types.js";
import {
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
  hashToken,
  newCommandId,
  newDeviceIdentity,
  newLeaseId,
  operationRequestId,
} from "./types.js";

interface DeviceRow {
  device_id: string;
  display_name: string;
  token_hash: string;
  enrolled_at: Date | string;
  last_seen_at: Date | string | null;
  revoked_at: Date | string | null;
}

interface CommandRow {
  id: string;
  device_id: string;
  operation: BridgeOperation;
  status: BridgeCommand["status"];
  created_at: Date | string;
  expires_at: Date | string;
  lease_expires_at: Date | string | null;
  lease_id: string | null;
  request_id: string | null;
  result: unknown | null;
  error: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapDevice(row: DeviceRow): BridgeDevice {
  return {
    deviceId: row.device_id,
    displayName: row.display_name,
    tokenHash: row.token_hash,
    enrolledAt: iso(row.enrolled_at),
    lastSeenAt: row.last_seen_at === null ? null : iso(row.last_seen_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
  };
}

function mapCommand(row: CommandRow): BridgeCommand {
  return {
    id: row.id,
    deviceId: row.device_id,
    operation: row.operation,
    status: row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    leaseExpiresAt: row.lease_expires_at === null ? null : iso(row.lease_expires_at),
    leaseId: row.lease_id ?? null,
    result: row.result,
    error: row.error,
  };
}

function safeHashEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export interface PostgresBridgeStoreOptions {
  connectionString: string;
  poolMax?: number;
}

/**
 * Durable, multi-instance bridge store for serverless and horizontally scaled hosts.
 * Tables are namespaced and created lazily; all command leasing is transactional.
 */
export class PostgresBridgeStore implements BridgeStore {
  private readonly pool: Pool;
  private initialized: Promise<void> | undefined;

  constructor(options: PostgresBridgeStoreOptions, pool?: Pool) {
    this.pool = pool ?? new Pool({
      connectionString: options.connectionString,
      max: options.poolMax ?? 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      application_name: "project-ambient-mcp",
    });
  }

  private ensureSchema(): Promise<void> {
    if (this.initialized) return this.initialized;
    const initialization = this.pool.query(`
      CREATE TABLE IF NOT EXISTS ambient_bridge_devices (
        device_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        enrolled_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS ambient_bridge_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES ambient_bridge_devices(device_id),
        operation JSONB NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'expired')),
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        lease_expires_at TIMESTAMPTZ,
        lease_id TEXT,
        request_id TEXT,
        result JSONB,
        error TEXT
      );
      ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS lease_id TEXT;
      ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS request_id TEXT;
      CREATE INDEX IF NOT EXISTS ambient_bridge_commands_delivery_idx
        ON ambient_bridge_commands (device_id, status, created_at);
      CREATE INDEX IF NOT EXISTS ambient_bridge_commands_request_idx
        ON ambient_bridge_commands (device_id, request_id) WHERE request_id IS NOT NULL;
    `).then(() => undefined);
    this.initialized = initialization;
    void initialization.catch(() => {
      if (this.initialized === initialization) this.initialized = undefined;
    });
    return initialization;
  }

  async createDevice(displayName: string): Promise<{ device: BridgeDevice; token: string }> {
    await this.ensureSchema();
    const { deviceId, token } = newDeviceIdentity();
    const { rows } = await this.pool.query<DeviceRow>(
      `INSERT INTO ambient_bridge_devices
        (device_id, display_name, token_hash, enrolled_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, NOW(), NULL, NULL)
       RETURNING *`,
      [deviceId, displayName, hashToken(token)],
    );
    const row = rows[0];
    if (!row) throw new Error("Device enrollment did not return a row.");
    return { device: mapDevice(row), token };
  }

  async getDevice(deviceId: string): Promise<BridgeDevice | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<DeviceRow>(
      "SELECT * FROM ambient_bridge_devices WHERE device_id = $1",
      [deviceId],
    );
    return rows[0] ? mapDevice(rows[0]) : null;
  }

  async authenticateDevice(deviceId: string, token: string): Promise<BridgeDevice | null> {
    const device = await this.getDevice(deviceId);
    if (!device || device.revokedAt || !safeHashEqual(hashToken(token), device.tokenHash)) return null;
    return device;
  }

  async touchDevice(deviceId: string, at: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "UPDATE ambient_bridge_devices SET last_seen_at = $2::timestamptz WHERE device_id = $1",
      [deviceId, at],
    );
  }

  async revokeDevice(deviceId: string, at: string): Promise<boolean> {
    await this.ensureSchema();
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE ambient_bridge_devices
         SET revoked_at = $2::timestamptz
         WHERE device_id = $1 AND revoked_at IS NULL
         RETURNING device_id`,
        [deviceId, at],
      );
      if ((result.rowCount ?? 0) === 0) return false;
      await client.query(
        `UPDATE ambient_bridge_commands
         SET status = 'failed', result = NULL,
             error = 'Device revoked before command completed.',
             lease_expires_at = NULL, lease_id = NULL
         WHERE device_id = $1 AND status IN ('pending', 'leased')`,
        [deviceId],
      );
      return true;
    });
  }

  async enqueue(deviceId: string, operation: BridgeOperation, ttlSeconds: number): Promise<BridgeCommand> {
    await this.ensureSchema();
    return this.transaction(async (client) => {
      const activeDevice = await client.query(
        `SELECT device_id FROM ambient_bridge_devices
         WHERE device_id = $1 AND revoked_at IS NULL
         FOR SHARE`,
        [deviceId],
      );
      if ((activeDevice.rowCount ?? 0) === 0) throw new BridgeDeviceUnavailableError();

      const requestId = operationRequestId(operation);
      if (requestId) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          JSON.stringify([deviceId, requestId]),
        ]);
        const existing = await client.query<CommandRow>(
          `SELECT * FROM ambient_bridge_commands
           WHERE device_id = $1
             AND (request_id = $2 OR (request_id IS NULL AND operation ->> 'requestId' = $2))
           ORDER BY created_at ASC, id ASC
           LIMIT 1
           FOR UPDATE`,
          [deviceId, requestId],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (!isDeepStrictEqual(existingRow.operation, operation)) throw new BridgeRequestConflictError();
          const normalized = existingRow.request_id === null
            ? await client.query<CommandRow>(
              `UPDATE ambient_bridge_commands SET request_id = $2 WHERE id = $1 RETURNING *`,
              [existingRow.id, requestId],
            )
            : null;
          const normalizedRow = normalized?.rows[0] ?? existingRow;
          const revived = await client.query<CommandRow>(
            `UPDATE ambient_bridge_commands
             SET status = 'pending', expires_at = NOW() + ($2 * INTERVAL '1 second'),
                 lease_expires_at = NULL, lease_id = NULL, result = NULL, error = NULL
             WHERE id = $1
               AND (status = 'expired'
                 OR (status IN ('pending', 'leased') AND expires_at <= NOW()))
             RETURNING *`,
            [existingRow.id, ttlSeconds],
          );
          return mapCommand(revived.rows[0] ?? normalizedRow);
        }
      }

      const { rows } = await client.query<CommandRow>(
        `INSERT INTO ambient_bridge_commands
          (id, device_id, operation, status, created_at, expires_at,
           lease_expires_at, lease_id, request_id, result, error)
         VALUES ($1, $2, $3::jsonb, 'pending', NOW(), NOW() + ($4 * INTERVAL '1 second'),
           NULL, NULL, $5, NULL, NULL)
         RETURNING *`,
        [newCommandId(), deviceId, JSON.stringify(operation), ttlSeconds, requestId],
      );
      const row = rows[0];
      if (!row) throw new Error("Command enqueue did not return a row.");
      return mapCommand(row);
    });
  }

  async leaseNext(deviceId: string, leaseSeconds: number): Promise<BridgeCommand | null> {
    await this.ensureSchema();
    return this.transaction(async (client) => {
      const activeDevice = await client.query(
        `SELECT device_id FROM ambient_bridge_devices
         WHERE device_id = $1 AND revoked_at IS NULL
         FOR SHARE`,
        [deviceId],
      );
      if ((activeDevice.rowCount ?? 0) === 0) return null;
      await client.query(
        `UPDATE ambient_bridge_commands
         SET status = 'expired', lease_expires_at = NULL, lease_id = NULL
         WHERE device_id = $1 AND status IN ('pending', 'leased') AND expires_at <= NOW()`,
        [deviceId],
      );
      await client.query(
        `UPDATE ambient_bridge_commands
         SET status = 'pending', lease_expires_at = NULL, lease_id = NULL
         WHERE device_id = $1 AND status = 'leased' AND lease_expires_at <= NOW() AND expires_at > NOW()`,
        [deviceId],
      );
      const selected = await client.query<CommandRow>(
        `SELECT * FROM ambient_bridge_commands
         WHERE device_id = $1 AND status = 'pending' AND expires_at > NOW()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [deviceId],
      );
      const row = selected.rows[0];
      if (!row) return null;
      const leaseId = newLeaseId();
      const leased = await client.query<CommandRow>(
        `UPDATE ambient_bridge_commands
         SET status = 'leased', lease_expires_at = NOW() + ($2 * INTERVAL '1 second'), lease_id = $3
         WHERE id = $1
         RETURNING *`,
        [row.id, leaseSeconds, leaseId],
      );
      return leased.rows[0] ? mapCommand(leased.rows[0]) : null;
    });
  }

  async complete(commandId: string, deviceId: string, leaseId: string, result: unknown): Promise<BridgeCommand | null> {
    return this.finish(commandId, deviceId, leaseId, "succeeded", result, null);
  }

  async fail(commandId: string, deviceId: string, leaseId: string, error: string): Promise<BridgeCommand | null> {
    return this.finish(commandId, deviceId, leaseId, "failed", null, error);
  }

  private async finish(
    commandId: string,
    deviceId: string,
    leaseId: string,
    status: "succeeded" | "failed",
    result: unknown,
    error: string | null,
  ): Promise<BridgeCommand | null> {
    await this.ensureSchema();
    return this.transaction(async (client) => {
      const activeDevice = await client.query(
        `SELECT device_id FROM ambient_bridge_devices
         WHERE device_id = $1 AND revoked_at IS NULL
         FOR SHARE`,
        [deviceId],
      );
      if ((activeDevice.rowCount ?? 0) === 0) return null;

      const { rows } = await client.query<CommandRow>(
        `UPDATE ambient_bridge_commands
         SET status = $4, result = $5::jsonb, error = $6, lease_expires_at = NULL
         WHERE id = $1 AND device_id = $2 AND lease_id = $3 AND status = 'leased'
           AND lease_expires_at > NOW() AND expires_at > NOW()
         RETURNING *`,
        [commandId, deviceId, leaseId, status, result === undefined ? null : JSON.stringify(result), error],
      );
      if (rows[0]) return mapCommand(rows[0]);

      const idempotent = await client.query<CommandRow>(
        `SELECT * FROM ambient_bridge_commands
         WHERE id = $1 AND device_id = $2 AND lease_id = $3 AND status = $4`,
        [commandId, deviceId, leaseId, status],
      );
      if (idempotent.rows[0]) return mapCommand(idempotent.rows[0]);

      await client.query(
        `UPDATE ambient_bridge_commands
         SET status = CASE WHEN expires_at <= NOW() THEN 'expired' ELSE 'pending' END,
             lease_expires_at = NULL, lease_id = NULL
         WHERE id = $1 AND device_id = $2 AND lease_id = $3 AND status = 'leased'
           AND (expires_at <= NOW() OR lease_expires_at <= NOW())`,
        [commandId, deviceId, leaseId],
      );
      return null;
    });
  }

  async getCommand(commandId: string): Promise<BridgeCommand | null> {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE ambient_bridge_commands
       SET status = 'expired', lease_expires_at = NULL, lease_id = NULL
       WHERE id = $1 AND status IN ('pending', 'leased') AND expires_at <= NOW()`,
      [commandId],
    );
    const { rows } = await this.pool.query<CommandRow>(
      "SELECT * FROM ambient_bridge_commands WHERE id = $1",
      [commandId],
    );
    return rows[0] ? mapCommand(rows[0]) : null;
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await run(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
