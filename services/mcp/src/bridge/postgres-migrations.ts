import type { PoolClient } from "pg";
import {
  BRIDGE_LEGACY_LEASE_ERROR,
  BRIDGE_REQUEST_ID_CONFLICT_ERROR,
  BridgeSchemaMigrationError,
} from "./types.js";

export const POSTGRES_BRIDGE_SCHEMA_VERSION = 3;

// Two fixed signed int32 keys keep migration serialization scoped to Project Ambient.
export const POSTGRES_BRIDGE_MIGRATION_LOCK = [1_096_644_681, 1_163_151_922] as const;

interface BridgeMigration {
  version: number;
  name: string;
  sql: string;
}

const migrationV1: BridgeMigration = {
  version: 1,
  name: "base_bridge_schema",
  sql: `
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
      result JSONB,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS ambient_bridge_commands_delivery_idx
      ON ambient_bridge_commands (device_id, status, created_at, id);
  `,
};

const migrationV2: BridgeMigration = {
  version: 2,
  name: "lease_fencing_and_request_identity",
  sql: `
    ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS lease_id TEXT;
    ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS request_id TEXT;
    ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS protocol_version SMALLINT;

    UPDATE ambient_bridge_commands
       SET status = 'failed',
           error = '${BRIDGE_LEGACY_LEASE_ERROR.replaceAll("'", "''")}',
           result = NULL,
           lease_expires_at = NULL,
           lease_id = NULL
     WHERE status = 'leased';

    WITH classified AS (
      SELECT id,
             NULLIF(btrim(request_id), '') AS column_request_id,
             request_id IS NOT NULL AND (
               NULLIF(btrim(request_id), '') IS NULL
               OR char_length(btrim(request_id)) NOT BETWEEN 16 AND 128
             ) AS column_request_id_invalid,
             CASE
               WHEN operation ? 'requestId'
                 AND jsonb_typeof(operation -> 'requestId') = 'string'
               THEN NULLIF(btrim(operation ->> 'requestId'), '')
               ELSE NULL
             END AS operation_request_id,
             operation ? 'requestId' AS operation_has_request_id,
             CASE
               WHEN operation ? 'requestId'
                 AND (
                   jsonb_typeof(operation -> 'requestId') IS DISTINCT FROM 'string'
                   OR NULLIF(btrim(operation ->> 'requestId'), '') IS NULL
                   OR char_length(btrim(operation ->> 'requestId')) NOT BETWEEN 16 AND 128
                 )
               THEN TRUE
               ELSE FALSE
             END AS operation_request_id_invalid
        FROM ambient_bridge_commands
    ), resolved AS (
      SELECT id,
             COALESCE(operation_request_id, column_request_id) AS candidate,
             operation_request_id_invalid OR column_request_id_invalid AS invalid,
             NOT operation_request_id_invalid
               AND NOT column_request_id_invalid
               AND column_request_id IS NOT NULL
                 AND operation_has_request_id
                 AND operation_request_id IS DISTINCT FROM column_request_id AS disagrees
        FROM classified
    )
    UPDATE ambient_bridge_commands AS command
       SET status = CASE WHEN command.status = 'pending' AND issue THEN 'failed' ELSE command.status END,
           error = CASE
             WHEN command.status = 'pending' AND resolved.disagrees
               THEN '${BRIDGE_REQUEST_ID_CONFLICT_ERROR.replaceAll("'", "''")}'
             WHEN command.status = 'pending' AND issue
               THEN 'Command was failed during upgrade because its request identifier was invalid.'
             ELSE command.error
           END,
           lease_expires_at = CASE WHEN command.status = 'pending' AND issue THEN NULL ELSE command.lease_expires_at END,
           lease_id = CASE WHEN command.status = 'pending' AND issue THEN NULL ELSE command.lease_id END,
           request_id = CASE WHEN issue THEN NULL ELSE resolved.candidate END,
           operation = CASE
             WHEN NOT issue
               AND resolved.candidate IS NOT NULL
               AND NOT (command.operation ? 'requestId')
             THEN jsonb_set(command.operation, '{requestId}', to_jsonb(resolved.candidate), TRUE)
             ELSE command.operation
           END
      FROM (
        SELECT *,
               disagrees OR invalid AS issue
          FROM resolved
      ) AS resolved
     WHERE command.id = resolved.id;

    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY device_id, request_id
               ORDER BY CASE status
                 WHEN 'succeeded' THEN 0
                 WHEN 'failed' THEN 1
                 WHEN 'pending' THEN 2
                 WHEN 'expired' THEN 3
                 ELSE 4
               END,
               created_at ASC,
               id ASC
             ) AS duplicate_rank
        FROM ambient_bridge_commands
       WHERE request_id IS NOT NULL
    )
    UPDATE ambient_bridge_commands AS command
       SET status = CASE WHEN command.status = 'pending' THEN 'failed' ELSE command.status END,
           error = CASE
             WHEN command.status = 'pending'
               THEN 'Command was failed during upgrade because its request identifier duplicated an earlier command.'
             ELSE command.error
           END,
           lease_expires_at = NULL,
           lease_id = CASE WHEN command.status = 'pending' THEN NULL ELSE command.lease_id END,
           request_id = NULL
      FROM ranked
     WHERE command.id = ranked.id
       AND ranked.duplicate_rank > 1;

    UPDATE ambient_bridge_commands
       SET lease_expires_at = NULL,
           lease_id = NULL
     WHERE status <> 'leased';

    UPDATE ambient_bridge_commands SET protocol_version = 2 WHERE protocol_version IS DISTINCT FROM 2;
    ALTER TABLE ambient_bridge_commands ALTER COLUMN protocol_version SET DEFAULT 2;
    ALTER TABLE ambient_bridge_commands ALTER COLUMN protocol_version SET NOT NULL;

    DROP INDEX IF EXISTS ambient_bridge_commands_request_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS ambient_bridge_commands_request_unique_idx
      ON ambient_bridge_commands (device_id, request_id)
      WHERE request_id IS NOT NULL;

    DO $migration$
    BEGIN
      ALTER TABLE ambient_bridge_commands
        ADD CONSTRAINT ambient_bridge_commands_request_id_valid
        CHECK (
          request_id IS NULL OR (
            request_id = btrim(request_id)
            AND char_length(request_id) BETWEEN 16 AND 128
          )
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;

    DO $migration$
    BEGIN
      ALTER TABLE ambient_bridge_commands
        ADD CONSTRAINT ambient_bridge_commands_lease_id_valid
        CHECK (lease_id IS NULL OR char_length(lease_id) BETWEEN 1 AND 128);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;

    DO $migration$
    BEGIN
      ALTER TABLE ambient_bridge_commands
        ADD CONSTRAINT ambient_bridge_commands_lease_shape_valid
        CHECK (
          (status = 'leased' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
          OR (status <> 'leased' AND lease_expires_at IS NULL)
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;

    DO $migration$
    BEGIN
      ALTER TABLE ambient_bridge_commands
        ADD CONSTRAINT ambient_bridge_commands_protocol_v2
        CHECK (protocol_version = 2);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;
  `,
};

const migrationV3: BridgeMigration = {
  version: 3,
  name: "bounded_delivery_attempts",
  sql: `
    ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS attempt_count INTEGER;
    ALTER TABLE ambient_bridge_commands ADD COLUMN IF NOT EXISTS max_attempts INTEGER;

    UPDATE ambient_bridge_commands SET attempt_count = 0 WHERE attempt_count IS NULL;
    UPDATE ambient_bridge_commands SET max_attempts = 3 WHERE max_attempts IS NULL;

    ALTER TABLE ambient_bridge_commands ALTER COLUMN attempt_count SET DEFAULT 0;
    ALTER TABLE ambient_bridge_commands ALTER COLUMN attempt_count SET NOT NULL;
    ALTER TABLE ambient_bridge_commands ALTER COLUMN max_attempts SET DEFAULT 3;
    ALTER TABLE ambient_bridge_commands ALTER COLUMN max_attempts SET NOT NULL;

    DO $migration$
    BEGIN
      ALTER TABLE ambient_bridge_commands
        ADD CONSTRAINT ambient_bridge_commands_attempt_count_valid
        CHECK (attempt_count >= 0 AND attempt_count <= max_attempts);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;

    DO $migration$
    BEGIN
      ALTER TABLE ambient_bridge_commands
        ADD CONSTRAINT ambient_bridge_commands_max_attempts_valid
        CHECK (max_attempts BETWEEN 1 AND 10);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;
  `,
};

export const POSTGRES_BRIDGE_MIGRATIONS: readonly BridgeMigration[] = [
  migrationV1,
  migrationV2,
  migrationV3,
];

function validateAppliedVersions(rows: Array<{ version: number }>): number {
  const versions = rows.map(({ version }) => Number(version));
  if (versions.some((version) => !Number.isInteger(version) || version < 1)) {
    throw new BridgeSchemaMigrationError("The bridge migration ledger contains an invalid version.");
  }
  const newestVersion = versions.at(-1) ?? 0;
  if (newestVersion > POSTGRES_BRIDGE_SCHEMA_VERSION) {
    throw new BridgeSchemaMigrationError(
      `Database bridge schema version ${newestVersion} is newer than supported version ${POSTGRES_BRIDGE_SCHEMA_VERSION}.`,
    );
  }
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index] !== index + 1) {
      throw new BridgeSchemaMigrationError("The bridge migration ledger contains a version gap.");
    }
  }
  return newestVersion;
}

export async function migratePostgresBridge(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [...POSTGRES_BRIDGE_MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ambient_bridge_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const applied = await client.query<{ version: number }>(
      "SELECT version FROM ambient_bridge_schema_migrations ORDER BY version ASC",
    );
    const currentVersion = validateAppliedVersions(applied.rows);
    for (const migration of POSTGRES_BRIDGE_MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ambient_bridge_schema_migrations (version, name, applied_at)
         VALUES ($1, $2, clock_timestamp())`,
        [migration.version, migration.name],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration failure as the actionable startup error.
    }
    if (error instanceof BridgeSchemaMigrationError) throw error;
    throw new BridgeSchemaMigrationError("PostgreSQL bridge schema migration failed.", { cause: error });
  }
}
