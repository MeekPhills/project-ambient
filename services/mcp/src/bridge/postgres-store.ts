import { timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool, type PoolClient } from "pg";
import { verifyPostgresBridgeSchema } from "./postgres-migrations.js";
import type {
  BridgeCommand,
  BridgeDevice,
  BridgeOperation,
  BridgeRateLimitScope,
  BridgeStore,
} from "./types.js";
import {
  BRIDGE_DEFAULT_MAX_ATTEMPTS,
  BRIDGE_PROTOCOL_VERSION,
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
  BridgeSchemaMigrationError,
  bridgeOperationSchema,
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
  protocol_version: number;
  attempt_count: number;
  max_attempts: number;
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
  if (row.protocol_version !== BRIDGE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported bridge command protocol version ${row.protocol_version}.`);
  }
  return {
    id: row.id,
    deviceId: row.device_id,
    operation: row.operation,
    status: row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    leaseExpiresAt: row.lease_expires_at === null ? null : iso(row.lease_expires_at),
    leaseId: row.lease_id,
    requestId: row.request_id,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
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
  rateLimitMaxActiveKeys?: number;
}

/** Durable, multi-instance bridge store for serverless and horizontally scaled hosts. */
export class PostgresBridgeStore implements BridgeStore {
  readonly distributedRateLimit = true;
  private readonly pool: Pool;
  private readonly rateLimitMaxActiveKeys: number;
  private initialization: Promise<void> | undefined;

  constructor(options: PostgresBridgeStoreOptions, pool?: Pool) {
    const maxActiveKeys = options.rateLimitMaxActiveKeys ?? 50_000;
    if (!Number.isInteger(maxActiveKeys) || maxActiveKeys < 1 || maxActiveKeys > 100_000) {
      throw new Error("rateLimitMaxActiveKeys must be an integer between 1 and 100000.");
    }
    this.rateLimitMaxActiveKeys = maxActiveKeys;
    this.pool = pool ?? new Pool({
      connectionString: options.connectionString,
      max: options.poolMax ?? 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      application_name: "project-ambient-mcp",
    });
  }

  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.runInitialization();
    return this.initialization;
  }

  async incrementRateLimit(
    scope: BridgeRateLimitScope,
    keyHash: string,
    windowMs: number,
  ): Promise<{
    totalHits: number;
    resetTime: Date;
  }> {
    await this.initialize();
    return this.rateLimitTransaction(async (client) => {
      const fastPath = await client.query<{ total_hits: number; reset_at: Date | string }>(
        `UPDATE "ambient_private"."ambient_bridge_rate_limits"
            SET total_hits = total_hits + 1
          WHERE scope = $1 AND key_hash = $2 AND reset_at > clock_timestamp()
          RETURNING total_hits, reset_at`,
        [scope, keyHash],
      );
      const fastRow = fastPath.rows[0];
      if (fastRow) {
        return {
          totalHits: fastRow.total_hits,
          resetTime: fastRow.reset_at instanceof Date ? fastRow.reset_at : new Date(fastRow.reset_at),
        };
      }
      // First-hit contenders serialize by key, then recheck before touching the
      // per-scope capacity row. Only the actual creator needs the broader lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        JSON.stringify([scope, keyHash]),
      ]);
      const concurrent = await client.query<{ total_hits: number; reset_at: Date | string }>(
        `UPDATE "ambient_private"."ambient_bridge_rate_limits"
            SET total_hits = total_hits + 1
          WHERE scope = $1 AND key_hash = $2 AND reset_at > clock_timestamp()
          RETURNING total_hits, reset_at`,
        [scope, keyHash],
      );
      const concurrentRow = concurrent.rows[0];
      if (concurrentRow) {
        return {
          totalHits: concurrentRow.total_hits,
          resetTime: concurrentRow.reset_at instanceof Date
            ? concurrentRow.reset_at
            : new Date(concurrentRow.reset_at),
        };
      }
      const state = await client.query(
        `SELECT active_keys FROM "ambient_private"."ambient_bridge_rate_limit_state"
          WHERE scope = $1 FOR UPDATE`,
        [scope],
      );
      if ((state.rowCount ?? 0) !== 1) throw new Error("Rate-limit scope metadata is unavailable.");
      await client.query(
        `WITH removed AS (
           DELETE FROM "ambient_private"."ambient_bridge_rate_limits"
            WHERE scope = $1 AND reset_at <= clock_timestamp()
            RETURNING 1
         )
         UPDATE "ambient_private"."ambient_bridge_rate_limit_state"
            SET active_keys = GREATEST(active_keys - (SELECT count(*) FROM removed), 0)
         WHERE scope = $1`,
        [scope],
      );
      const capacity = await client.query(
        `UPDATE "ambient_private"."ambient_bridge_rate_limit_state"
            SET active_keys = active_keys + 1
          WHERE scope = $1 AND active_keys < $2
          RETURNING active_keys`,
        [scope, this.rateLimitMaxActiveKeys],
      );
      if ((capacity.rowCount ?? 0) === 0) {
        throw new Error(`Distributed rate-limit counter capacity is exhausted for ${scope}.`);
      }
      const result = await client.query<{ total_hits: number; reset_at: Date | string }>(
        `INSERT INTO "ambient_private"."ambient_bridge_rate_limits" (scope, key_hash, total_hits, reset_at)
         VALUES ($1, $2, 1, clock_timestamp() + ($3 * INTERVAL '1 millisecond'))
         RETURNING total_hits, reset_at`,
        [scope, keyHash, windowMs],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Rate-limit increment did not return a row.");
      return {
        totalHits: row.total_hits,
        resetTime: row.reset_at instanceof Date ? row.reset_at : new Date(row.reset_at),
      };
    });
  }

  async decrementRateLimit(scope: BridgeRateLimitScope, keyHash: string): Promise<void> {
    await this.initialize();
    await this.rateLimitTransaction(async (client) => {
      await client.query(
        `SELECT active_keys FROM "ambient_private"."ambient_bridge_rate_limit_state"
          WHERE scope = $1 FOR UPDATE`,
        [scope],
      );
      const removed = await client.query(
        `DELETE FROM "ambient_private"."ambient_bridge_rate_limits"
          WHERE scope = $1 AND key_hash = $2 AND total_hits = 1
          RETURNING key_hash`,
        [scope, keyHash],
      );
      if ((removed.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE "ambient_private"."ambient_bridge_rate_limit_state"
            SET active_keys = GREATEST(active_keys - 1, 0)
            WHERE scope = $1`,
          [scope],
        );
        return;
      }
      await client.query(
        `UPDATE "ambient_private"."ambient_bridge_rate_limits"
            SET total_hits = total_hits - 1
          WHERE scope = $1 AND key_hash = $2 AND total_hits > 1`,
        [scope, keyHash],
      );
    });
  }

  async resetRateLimit(scope: BridgeRateLimitScope, keyHash: string): Promise<void> {
    await this.initialize();
    await this.rateLimitTransaction(async (client) => {
      await client.query(
        `SELECT active_keys FROM "ambient_private"."ambient_bridge_rate_limit_state"
          WHERE scope = $1 FOR UPDATE`,
        [scope],
      );
      const removed = await client.query(
        `DELETE FROM "ambient_private"."ambient_bridge_rate_limits"
          WHERE scope = $1 AND key_hash = $2 RETURNING key_hash`,
        [scope, keyHash],
      );
      if ((removed.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE "ambient_private"."ambient_bridge_rate_limit_state"
            SET active_keys = GREATEST(active_keys - 1, 0)
            WHERE scope = $1`,
          [scope],
        );
      }
    });
  }

  private async runInitialization(): Promise<void> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await verifyPostgresBridgeSchema(client);
    } catch (error) {
      if (error instanceof BridgeSchemaMigrationError) throw error;
      throw new BridgeSchemaMigrationError("Could not initialize the PostgreSQL bridge store.", { cause: error });
    } finally {
      client?.release();
    }
  }

  private async rateLimitTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '1s'");
      await client.query("SET LOCAL statement_timeout = '3s'");
      return run(client);
    });
  }

  async createDevice(displayName: string): Promise<{ device: BridgeDevice; token: string }> {
    await this.initialize();
    const { deviceId, token } = newDeviceIdentity();
    const { rows } = await this.pool.query<DeviceRow>(
      `INSERT INTO "ambient_private"."ambient_bridge_devices"
        (device_id, display_name, token_hash, enrolled_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, clock_timestamp(), NULL, NULL)
       RETURNING *`,
      [deviceId, displayName, hashToken(token)],
    );
    const row = rows[0];
    if (!row) throw new Error("Device enrollment did not return a row.");
    return { device: mapDevice(row), token };
  }

  async getDevice(deviceId: string): Promise<BridgeDevice | null> {
    await this.initialize();
    const { rows } = await this.pool.query<DeviceRow>(
      `SELECT * FROM "ambient_private"."ambient_bridge_devices" WHERE device_id = $1`,
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
    await this.initialize();
    await this.pool.query(
      `UPDATE "ambient_private"."ambient_bridge_devices"
          SET last_seen_at = $2::timestamptz WHERE device_id = $1`,
      [deviceId, at],
    );
  }

  async revokeDevice(deviceId: string, at: string): Promise<boolean> {
    await this.initialize();
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE "ambient_private"."ambient_bridge_devices"
         SET revoked_at = $2::timestamptz
         WHERE device_id = $1 AND revoked_at IS NULL
         RETURNING device_id`,
        [deviceId, at],
      );
      if ((result.rowCount ?? 0) === 0) return false;
      await client.query(
        `UPDATE "ambient_private"."ambient_bridge_commands"
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
    await this.initialize();
    const normalizedOperation = bridgeOperationSchema.parse(operation);
    return this.transaction(async (client) => {
      const activeDevice = await client.query(
        `SELECT device_id FROM "ambient_private"."ambient_bridge_devices"
         WHERE device_id = $1 AND revoked_at IS NULL
         FOR SHARE`,
        [deviceId],
      );
      if ((activeDevice.rowCount ?? 0) === 0) throw new BridgeDeviceUnavailableError();

      const requestId = operationRequestId(normalizedOperation);
      if (requestId) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          JSON.stringify([deviceId, requestId]),
        ]);
        const existing = await client.query<CommandRow>(
          `SELECT * FROM "ambient_private"."ambient_bridge_commands"
           WHERE device_id = $1 AND request_id = $2
           ORDER BY created_at ASC, id ASC
           LIMIT 1
           FOR UPDATE`,
          [deviceId, requestId],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (!isDeepStrictEqual(existingRow.operation, normalizedOperation)) {
            throw new BridgeRequestConflictError();
          }
          const revived = await client.query<CommandRow>(
            `UPDATE "ambient_private"."ambient_bridge_commands"
             SET status = 'pending',
                 expires_at = clock_timestamp() + ($2 * INTERVAL '1 second'),
                 lease_expires_at = NULL, lease_id = NULL,
                 attempt_count = 0, result = NULL, error = NULL
             WHERE id = $1
               AND (status = 'expired'
                 OR (status IN ('pending', 'leased') AND expires_at <= clock_timestamp()))
             RETURNING *`,
            [existingRow.id, ttlSeconds],
          );
          return mapCommand(revived.rows[0] ?? existingRow);
        }
      }

      const { rows } = await client.query<CommandRow>(
        `INSERT INTO "ambient_private"."ambient_bridge_commands"
          (id, device_id, operation, status, created_at, expires_at,
           lease_expires_at, lease_id, request_id, protocol_version,
           attempt_count, max_attempts, result, error)
         VALUES ($1, $2, $3::jsonb, 'pending', clock_timestamp(),
           clock_timestamp() + ($4 * INTERVAL '1 second'),
           NULL, NULL, $5, $6, 0, $7, NULL, NULL)
         RETURNING *`,
        [
          newCommandId(),
          deviceId,
          JSON.stringify(normalizedOperation),
          ttlSeconds,
          requestId,
          BRIDGE_PROTOCOL_VERSION,
          BRIDGE_DEFAULT_MAX_ATTEMPTS,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("Command enqueue did not return a row.");
      return mapCommand(row);
    });
  }

  async leaseNext(deviceId: string, leaseSeconds: number): Promise<BridgeCommand | null> {
    await this.initialize();
    return this.transaction(async (client) => {
      const activeDevice = await client.query(
        `SELECT device_id FROM "ambient_private"."ambient_bridge_devices"
         WHERE device_id = $1 AND revoked_at IS NULL
         FOR SHARE`,
        [deviceId],
      );
      if ((activeDevice.rowCount ?? 0) === 0) return null;

      await this.reconcileCommands(client, deviceId);
      await client.query(
        `UPDATE "ambient_private"."ambient_bridge_commands"
            SET status = 'expired', lease_expires_at = NULL, lease_id = NULL
          WHERE device_id = $1
            AND status = 'pending'
            AND expires_at <= clock_timestamp() + ($2 * INTERVAL '1 second')`,
        [deviceId, leaseSeconds],
      );
      const leaseId = newLeaseId();
      const leased = await client.query<CommandRow>(
        `WITH candidate AS (
           SELECT id
             FROM "ambient_private"."ambient_bridge_commands"
            WHERE device_id = $1
              AND status = 'pending'
              AND expires_at > clock_timestamp() + ($2 * INTERVAL '1 second')
              AND attempt_count < max_attempts
            ORDER BY created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE "ambient_private"."ambient_bridge_commands" AS command
            SET status = 'leased',
                lease_expires_at = clock_timestamp() + ($2 * INTERVAL '1 second'),
                lease_id = $3,
                attempt_count = command.attempt_count + 1,
                protocol_version = $4
           FROM candidate
          WHERE command.id = candidate.id
            AND command.status = 'pending'
            AND command.attempt_count < command.max_attempts
         RETURNING command.*`,
        [deviceId, leaseSeconds, leaseId, BRIDGE_PROTOCOL_VERSION],
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
    await this.initialize();
    return this.transaction(async (client) => {
      const activeDevice = await client.query(
        `SELECT device_id FROM "ambient_private"."ambient_bridge_devices"
         WHERE device_id = $1 AND revoked_at IS NULL
         FOR SHARE`,
        [deviceId],
      );
      if ((activeDevice.rowCount ?? 0) === 0) return null;

      const { rows } = await client.query<CommandRow>(
        `UPDATE "ambient_private"."ambient_bridge_commands"
         SET status = $4, result = $5::jsonb, error = $6, lease_expires_at = NULL
         WHERE id = $1 AND device_id = $2 AND lease_id = $3 AND status = 'leased'
           AND lease_expires_at > clock_timestamp()
           AND expires_at > clock_timestamp()
         RETURNING *`,
        [commandId, deviceId, leaseId, status, result === undefined ? null : JSON.stringify(result), error],
      );
      if (rows[0]) return mapCommand(rows[0]);

      const idempotent = await client.query<CommandRow>(
        `SELECT * FROM "ambient_private"."ambient_bridge_commands"
         WHERE id = $1 AND device_id = $2 AND lease_id = $3 AND status = $4`,
        [commandId, deviceId, leaseId, status],
      );
      if (idempotent.rows[0]) return mapCommand(idempotent.rows[0]);

      await this.reconcileCommands(client, deviceId, commandId, leaseId);
      return null;
    });
  }

  async getCommand(commandId: string): Promise<BridgeCommand | null> {
    await this.initialize();
    return this.transaction(async (client) => {
      await this.reconcileCommands(client, undefined, commandId);
      const { rows } = await client.query<CommandRow>(
        `SELECT * FROM "ambient_private"."ambient_bridge_commands" WHERE id = $1`,
        [commandId],
      );
      return rows[0] ? mapCommand(rows[0]) : null;
    });
  }

  private async reconcileCommands(
    client: PoolClient,
    deviceId?: string,
    commandId?: string,
    leaseId?: string,
  ): Promise<void> {
    const filters = [
      deviceId === undefined ? "TRUE" : "device_id = $1",
      commandId === undefined ? "TRUE" : `id = $${deviceId === undefined ? 1 : 2}`,
      leaseId === undefined
        ? "TRUE"
        : `lease_id = $${(deviceId === undefined ? 0 : 1) + (commandId === undefined ? 0 : 1) + 1}`,
    ];
    const values = [deviceId, commandId, leaseId].filter((value): value is string => value !== undefined);
    const scope = filters.join(" AND ");

    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_commands"
          SET status = 'expired', lease_expires_at = NULL, lease_id = NULL
        WHERE ${scope}
          AND status IN ('pending', 'leased')
          AND expires_at <= clock_timestamp()`,
      values,
    );
    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_commands"
          SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
              error = CASE
                WHEN attempt_count >= max_attempts
                  THEN format('Command delivery failed after %s lease attempts.', max_attempts)
                ELSE NULL
              END,
              lease_expires_at = NULL,
              lease_id = NULL
        WHERE ${scope}
          AND status = 'leased'
          AND lease_expires_at <= clock_timestamp()
          AND expires_at > clock_timestamp()`,
      values,
    );
    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_commands"
          SET status = 'failed',
              error = format('Command delivery failed after %s lease attempts.', max_attempts),
              lease_expires_at = NULL,
              lease_id = NULL
        WHERE ${scope}
          AND status = 'pending'
          AND attempt_count >= max_attempts`,
      values,
    );
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await run(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the operation error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
