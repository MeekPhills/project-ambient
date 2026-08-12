import type { PoolClient } from "pg";
import {
  BRIDGE_LEGACY_LEASE_ERROR,
  BRIDGE_REQUEST_ID_CONFLICT_ERROR,
  BridgeSchemaMigrationError,
} from "./types.js";

export const POSTGRES_BRIDGE_SCHEMA_VERSION = 4;
export const POSTGRES_BRIDGE_SCHEMA = "ambient_private" as const;

const PRIVATE_SCHEMA = `"${POSTGRES_BRIDGE_SCHEMA}"`;
const EXPECTED_RELATIONS = [
  "ambient_bridge_commands",
  "ambient_bridge_devices",
  "ambient_bridge_rate_limit_state",
  "ambient_bridge_rate_limits",
  "ambient_bridge_schema_migrations",
] as const;

const LEGACY_PUBLIC_MOVES = [
  ["ambient_bridge_devices", `ALTER TABLE "public"."ambient_bridge_devices" SET SCHEMA ${PRIVATE_SCHEMA}`],
  ["ambient_bridge_commands", `ALTER TABLE "public"."ambient_bridge_commands" SET SCHEMA ${PRIVATE_SCHEMA}`],
  ["ambient_bridge_rate_limits", `ALTER TABLE "public"."ambient_bridge_rate_limits" SET SCHEMA ${PRIVATE_SCHEMA}`],
  ["ambient_bridge_rate_limit_state", `ALTER TABLE "public"."ambient_bridge_rate_limit_state" SET SCHEMA ${PRIVATE_SCHEMA}`],
  ["ambient_bridge_schema_migrations", `ALTER TABLE "public"."ambient_bridge_schema_migrations" SET SCHEMA ${PRIVATE_SCHEMA}`],
] as const;

const SUPABASE_EXPOSED_ROLES = ["anon", "authenticated", "service_role"] as const;

interface ExpectedColumn {
  relation: string;
  column: string;
  dataType: string;
  notNull: boolean;
}

const EXPECTED_COLUMNS: readonly ExpectedColumn[] = ([
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
] as const).map(([relation, column, dataType, notNull]) => ({ relation, column, dataType, notNull }));

const EXPECTED_CONSTRAINTS = [
  ["ambient_bridge_commands_attempt_count_valid", "ambient_bridge_commands", "c", /attempt_count.*>= 0.*attempt_count.*<= max_attempts/],
  ["ambient_bridge_commands_device_id_fkey", "ambient_bridge_commands", "f", /^FOREIGN KEY \(device_id\) REFERENCES ambient_private\.ambient_bridge_devices\(device_id\)$/],
  ["ambient_bridge_commands_lease_id_valid", "ambient_bridge_commands", "c", /lease_id IS NULL.*char_length\(lease_id\).*>= 1.*char_length\(lease_id\).*<= 128/],
  ["ambient_bridge_commands_lease_shape_valid", "ambient_bridge_commands", "c", /status = 'leased'.*lease_id IS NOT NULL.*lease_expires_at IS NOT NULL.*status <> 'leased'.*lease_expires_at IS NULL/],
  ["ambient_bridge_commands_max_attempts_valid", "ambient_bridge_commands", "c", /max_attempts.*>= 1.*max_attempts.*<= 10/],
  ["ambient_bridge_commands_pkey", "ambient_bridge_commands", "p", /^PRIMARY KEY \(id\)$/],
  ["ambient_bridge_commands_protocol_v2", "ambient_bridge_commands", "c", /protocol_version = 2/],
  ["ambient_bridge_commands_request_id_valid", "ambient_bridge_commands", "c", /request_id IS NULL.*request_id = btrim\(request_id\).*char_length\(request_id\).*>= 16.*char_length\(request_id\).*<= 128/],
  ["ambient_bridge_commands_status_check", "ambient_bridge_commands", "c", /status.*pending.*leased.*succeeded.*failed.*expired/],
  ["ambient_bridge_devices_pkey", "ambient_bridge_devices", "p", /^PRIMARY KEY \(device_id\)$/],
  ["ambient_bridge_rate_limit_state_active_keys_check", "ambient_bridge_rate_limit_state", "c", /active_keys.*>= 0.*active_keys.*<= 100000/],
  ["ambient_bridge_rate_limit_state_pkey", "ambient_bridge_rate_limit_state", "p", /^PRIMARY KEY \(scope\)$/],
  ["ambient_bridge_rate_limit_state_scope_check", "ambient_bridge_rate_limit_state", "c", /scope.*mcp-ingress.*mcp-authorized.*ingress.*admin.*device-poll.*device-result/],
  ["ambient_bridge_rate_limits_key_hash_check", "ambient_bridge_rate_limits", "c", /char_length\(key_hash\).*>= 32.*char_length\(key_hash\).*<= 128/],
  ["ambient_bridge_rate_limits_pkey", "ambient_bridge_rate_limits", "p", /^PRIMARY KEY \(scope, key_hash\)$/],
  ["ambient_bridge_rate_limits_scope_check", "ambient_bridge_rate_limits", "c", /scope.*mcp-ingress.*mcp-authorized.*ingress.*admin.*device-poll.*device-result/],
  ["ambient_bridge_rate_limits_total_hits_check", "ambient_bridge_rate_limits", "c", /total_hits >= 1/],
  ["ambient_bridge_schema_migrations_pkey", "ambient_bridge_schema_migrations", "p", /^PRIMARY KEY \(version\)$/],
] as const;

const REQUIRED_INDEXES = [
  "ambient_bridge_commands_delivery_idx",
  "ambient_bridge_commands_request_unique_idx",
  "ambient_bridge_rate_limits_reset_idx",
] as const;

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
    CREATE TABLE IF NOT EXISTS "ambient_private"."ambient_bridge_devices" (
      device_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      enrolled_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS "ambient_private"."ambient_bridge_commands" (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES "ambient_private"."ambient_bridge_devices"(device_id),
      operation JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'expired')),
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      lease_expires_at TIMESTAMPTZ,
      result JSONB,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS "ambient_bridge_commands_delivery_idx"
      ON "ambient_private"."ambient_bridge_commands" (device_id, status, created_at, id);
  `,
};

const migrationV2: BridgeMigration = {
  version: 2,
  name: "lease_fencing_and_request_identity",
  sql: `
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ADD COLUMN IF NOT EXISTS lease_id TEXT;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ADD COLUMN IF NOT EXISTS request_id TEXT;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ADD COLUMN IF NOT EXISTS protocol_version SMALLINT;

    UPDATE "ambient_private"."ambient_bridge_commands"
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
        FROM "ambient_private"."ambient_bridge_commands"
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
    UPDATE "ambient_private"."ambient_bridge_commands" AS command
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
        FROM "ambient_private"."ambient_bridge_commands"
       WHERE request_id IS NOT NULL
    )
    UPDATE "ambient_private"."ambient_bridge_commands" AS command
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

    UPDATE "ambient_private"."ambient_bridge_commands"
       SET lease_expires_at = NULL,
           lease_id = NULL
     WHERE status <> 'leased';

    UPDATE "ambient_private"."ambient_bridge_commands" SET protocol_version = 2 WHERE protocol_version IS DISTINCT FROM 2;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ALTER COLUMN protocol_version SET DEFAULT 2;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ALTER COLUMN protocol_version SET NOT NULL;

    DROP INDEX IF EXISTS "ambient_private"."ambient_bridge_commands_request_idx";
    CREATE UNIQUE INDEX IF NOT EXISTS "ambient_bridge_commands_request_unique_idx"
      ON "ambient_private"."ambient_bridge_commands" (device_id, request_id)
      WHERE request_id IS NOT NULL;

    DO $migration$
    BEGIN
      ALTER TABLE "ambient_private"."ambient_bridge_commands"
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
      ALTER TABLE "ambient_private"."ambient_bridge_commands"
        ADD CONSTRAINT ambient_bridge_commands_lease_id_valid
        CHECK (lease_id IS NULL OR char_length(lease_id) BETWEEN 1 AND 128);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;

    DO $migration$
    BEGIN
      ALTER TABLE "ambient_private"."ambient_bridge_commands"
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
      ALTER TABLE "ambient_private"."ambient_bridge_commands"
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
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ADD COLUMN IF NOT EXISTS attempt_count INTEGER;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ADD COLUMN IF NOT EXISTS max_attempts INTEGER;

    UPDATE "ambient_private"."ambient_bridge_commands" SET attempt_count = 0 WHERE attempt_count IS NULL;
    UPDATE "ambient_private"."ambient_bridge_commands" SET max_attempts = 3 WHERE max_attempts IS NULL;

    ALTER TABLE "ambient_private"."ambient_bridge_commands" ALTER COLUMN attempt_count SET DEFAULT 0;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ALTER COLUMN attempt_count SET NOT NULL;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ALTER COLUMN max_attempts SET DEFAULT 3;
    ALTER TABLE "ambient_private"."ambient_bridge_commands" ALTER COLUMN max_attempts SET NOT NULL;

    DO $migration$
    BEGIN
      ALTER TABLE "ambient_private"."ambient_bridge_commands"
        ADD CONSTRAINT ambient_bridge_commands_attempt_count_valid
        CHECK (attempt_count >= 0 AND attempt_count <= max_attempts);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;

    DO $migration$
    BEGIN
      ALTER TABLE "ambient_private"."ambient_bridge_commands"
        ADD CONSTRAINT ambient_bridge_commands_max_attempts_valid
        CHECK (max_attempts BETWEEN 1 AND 10);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END
    $migration$;
  `,
};

const migrationV4: BridgeMigration = {
  version: 4,
  name: "distributed_rate_limits",
  sql: `
    CREATE TABLE IF NOT EXISTS "ambient_private"."ambient_bridge_rate_limits" (
      scope TEXT NOT NULL CHECK (scope IN (
        'mcp-ingress', 'mcp-authorized', 'ingress', 'admin', 'device-poll', 'device-result'
      )),
      key_hash TEXT NOT NULL,
      total_hits INTEGER NOT NULL CHECK (total_hits >= 1),
      reset_at TIMESTAMPTZ NOT NULL,
      CHECK (char_length(key_hash) BETWEEN 32 AND 128),
      PRIMARY KEY (scope, key_hash)
    );

    CREATE INDEX IF NOT EXISTS "ambient_bridge_rate_limits_reset_idx"
      ON "ambient_private"."ambient_bridge_rate_limits" (scope, reset_at);

    CREATE TABLE IF NOT EXISTS "ambient_private"."ambient_bridge_rate_limit_state" (
      scope TEXT PRIMARY KEY CHECK (scope IN (
        'mcp-ingress', 'mcp-authorized', 'ingress', 'admin', 'device-poll', 'device-result'
      )),
      active_keys INTEGER NOT NULL DEFAULT 0 CHECK (active_keys BETWEEN 0 AND 100000)
    );

    INSERT INTO "ambient_private"."ambient_bridge_rate_limit_state" (scope, active_keys)
    SELECT configured.scope, count(rate_limit.key_hash)::integer
      FROM (VALUES
        ('mcp-ingress'), ('mcp-authorized'), ('ingress'), ('admin'),
        ('device-poll'), ('device-result')
      ) AS configured(scope)
      LEFT JOIN "ambient_private"."ambient_bridge_rate_limits" AS rate_limit ON rate_limit.scope = configured.scope
     GROUP BY configured.scope
    ON CONFLICT (scope) DO UPDATE SET active_keys = EXCLUDED.active_keys;
  `,
};

export const POSTGRES_BRIDGE_MIGRATIONS: readonly BridgeMigration[] = [
  migrationV1,
  migrationV2,
  migrationV3,
  migrationV4,
];

function validateAppliedVersions(rows: Array<{ version: number; name?: string }>): number {
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
    const expectedName = POSTGRES_BRIDGE_MIGRATIONS[index]?.name;
    const recordedName = rows[index]?.name;
    if (recordedName !== undefined && recordedName !== expectedName) {
      throw new BridgeSchemaMigrationError(
        `The bridge migration ledger has an unexpected name for version ${versions[index]}.`,
      );
    }
  }
  return newestVersion;
}

async function listAmbientRelations(
  client: PoolClient,
  schema: string,
  tablesOnly = true,
): Promise<string[]> {
  const result = await client.query<{ relname: string }>(
    `SELECT class.relname
       FROM pg_catalog.pg_class AS class
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = $1
        AND ($3::boolean = FALSE OR class.relkind IN ('r', 'p'))
        AND class.relname = ANY($2::text[])
      ORDER BY class.relname`,
    [schema, [...EXPECTED_RELATIONS], tablesOnly],
  );
  return result.rows.map(({ relname }) => relname);
}

async function listPublicAmbientRelations(
  client: PoolClient,
): Promise<Array<{ relname: string; relkind: string }>> {
  const result = await client.query<{ relname: string; relkind: string }>(
    `SELECT class.relname, class.relkind
       FROM pg_catalog.pg_class AS class
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND class.relname LIKE 'ambient\\_bridge\\_%' ESCAPE '\\'
      ORDER BY class.relname`,
  );
  return result.rows;
}

async function revokeExposedRoleAccess(client: PoolClient): Promise<void> {
  await client.query(`REVOKE ALL ON SCHEMA ${PRIVATE_SCHEMA} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${PRIVATE_SCHEMA} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${PRIVATE_SCHEMA} FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${PRIVATE_SCHEMA} REVOKE ALL ON TABLES FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${PRIVATE_SCHEMA} REVOKE ALL ON SEQUENCES FROM PUBLIC`);
  const roles = await client.query<{ rolname: string }>(
    "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])",
    [[...SUPABASE_EXPOSED_ROLES]],
  );
  for (const { rolname } of roles.rows) {
    if (!SUPABASE_EXPOSED_ROLES.includes(rolname as typeof SUPABASE_EXPOSED_ROLES[number])) continue;
    const quotedRole = `"${rolname.replaceAll('"', '""')}"`;
    await client.query(`REVOKE ALL ON SCHEMA ${PRIVATE_SCHEMA} FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${PRIVATE_SCHEMA} FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${PRIVATE_SCHEMA} FROM ${quotedRole}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${PRIVATE_SCHEMA} REVOKE ALL ON TABLES FROM ${quotedRole}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${PRIVATE_SCHEMA} REVOKE ALL ON SEQUENCES FROM ${quotedRole}`,
    );
  }
}

async function moveLegacyPublicLayout(client: PoolClient): Promise<void> {
  const publicObjects = await listPublicAmbientRelations(client);
  const publicRelations = publicObjects.map(({ relname }) => relname);
  if (publicRelations.length === 0) return;
  if (publicObjects.some(({ relkind }) => relkind !== "r" && relkind !== "p")) {
    throw new BridgeSchemaMigrationError(
      "A legacy public Project Ambient relation is not a table; refusing to adopt it.",
    );
  }
  const privateRelations = await listAmbientRelations(client, POSTGRES_BRIDGE_SCHEMA);
  if (privateRelations.length > 0) {
    throw new BridgeSchemaMigrationError(
      "Both public and private Project Ambient bridge relations exist; refusing an ambiguous migration.",
    );
  }
  if (!publicRelations.includes("ambient_bridge_schema_migrations")) {
    throw new BridgeSchemaMigrationError(
      "Legacy public bridge relations exist without a migration ledger; refusing to infer their version.",
    );
  }
  const applied = await client.query<{ version: number; name: string }>(
    `SELECT version, name
       FROM "public"."ambient_bridge_schema_migrations"
      ORDER BY version ASC`,
  );
  const currentVersion = validateAppliedVersions(applied.rows);
  const expectedLegacyRelations = [
    "ambient_bridge_commands",
    "ambient_bridge_devices",
    ...(currentVersion >= 4
      ? ["ambient_bridge_rate_limit_state", "ambient_bridge_rate_limits"]
      : []),
    "ambient_bridge_schema_migrations",
  ].sort();
  if (publicRelations.length !== expectedLegacyRelations.length
    || publicRelations.some((relation, index) => relation !== expectedLegacyRelations[index])) {
    throw new BridgeSchemaMigrationError(
      "The legacy public bridge layout does not match its migration ledger; refusing to adopt it.",
    );
  }
  for (const [relation, sql] of LEGACY_PUBLIC_MOVES) {
    if (publicRelations.includes(relation)) await client.query(sql);
  }
}

/** Read-only schema-layout verification. This function intentionally performs no DDL. */
async function verifyPostgresBridgeLayout(client: PoolClient): Promise<void> {
  try {
    const applied = await client.query<{ version: number; name: string }>(
      `SELECT version, name
         FROM "ambient_private"."ambient_bridge_schema_migrations"
        ORDER BY version ASC`,
    );
    const currentVersion = validateAppliedVersions(applied.rows);
    if (currentVersion !== POSTGRES_BRIDGE_SCHEMA_VERSION) {
      throw new BridgeSchemaMigrationError(
        `Database bridge schema version ${currentVersion} is outdated; expected version ${POSTGRES_BRIDGE_SCHEMA_VERSION}.`,
      );
    }
    const relations = await listAmbientRelations(client, POSTGRES_BRIDGE_SCHEMA);
    if (relations.length !== EXPECTED_RELATIONS.length
      || relations.some((relation, index) => relation !== EXPECTED_RELATIONS[index])) {
      throw new BridgeSchemaMigrationError("The private bridge schema is missing required relations.");
    }
    if ((await listPublicAmbientRelations(client)).length > 0) {
      throw new BridgeSchemaMigrationError("Project Ambient bridge relations remain in the public schema.");
    }
    const columns = await client.query<{
      relation: string;
      column: string;
      data_type: string;
      not_null: boolean;
    }>(
      `SELECT class.relname AS relation,
              attribute.attname AS column,
              pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
              attribute.attnotnull AS not_null
         FROM pg_catalog.pg_attribute AS attribute
         JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = $1
          AND class.relname = ANY($2::text[])
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY class.relname, attribute.attnum`,
      [POSTGRES_BRIDGE_SCHEMA, [...EXPECTED_RELATIONS]],
    );
    const actualColumns = columns.rows.map(({ relation, column, data_type, not_null }) => ({
      relation,
      column,
      dataType: data_type,
      notNull: not_null,
    }));
    if (JSON.stringify(actualColumns) !== JSON.stringify(EXPECTED_COLUMNS)) {
      throw new BridgeSchemaMigrationError("The private bridge schema column layout is invalid.");
    }
    const constraints = await client.query<{
      conname: string;
      relation: string;
      contype: string;
      validated: boolean;
      definition: string;
    }>(
      `SELECT constraint_record.conname, class.relname AS relation,
              constraint_record.contype, constraint_record.convalidated AS validated,
              pg_catalog.pg_get_constraintdef(constraint_record.oid, TRUE) AS definition
         FROM pg_catalog.pg_constraint AS constraint_record
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = constraint_record.connamespace
         JOIN pg_catalog.pg_class AS class ON class.oid = constraint_record.conrelid
        WHERE namespace.nspname = $1
          AND constraint_record.conname = ANY($2::text[])
        ORDER BY constraint_record.conname`,
      [POSTGRES_BRIDGE_SCHEMA, EXPECTED_CONSTRAINTS.map(([name]) => name)],
    );
    if (constraints.rows.length !== EXPECTED_CONSTRAINTS.length
      || constraints.rows.some(({ conname, relation, contype, validated, definition }, index) => {
        const expected = EXPECTED_CONSTRAINTS[index];
        if (!expected) return true;
        const [expectedName, expectedRelation, expectedType, expectedDefinition] = expected;
        return conname !== expectedName
          || relation !== expectedRelation
          || contype !== expectedType
          || !validated
          || !expectedDefinition.test(definition.replaceAll(/\s+/g, " "));
      })) {
      throw new BridgeSchemaMigrationError("The private bridge schema is missing required constraints.");
    }
    const indexes = await client.query<{
      index_name: string;
      relation: string;
      valid: boolean;
      unique_index: boolean;
      predicate: string | null;
      definition: string;
    }>(
      `SELECT index_class.relname AS index_name, table_class.relname AS relation,
              index_record.indisvalid AS valid, index_record.indisunique AS unique_index,
              pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid) AS predicate,
              pg_catalog.pg_get_indexdef(index_record.indexrelid) AS definition
         FROM pg_catalog.pg_index AS index_record
         JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_record.indexrelid
         JOIN pg_catalog.pg_class AS table_class ON table_class.oid = index_record.indrelid
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
        WHERE namespace.nspname = $1
          AND index_class.relname = ANY($2::text[])
        ORDER BY index_class.relname`,
      [POSTGRES_BRIDGE_SCHEMA, [...REQUIRED_INDEXES]],
    );
    if (indexes.rows.length !== REQUIRED_INDEXES.length
      || indexes.rows.some((row, index) => {
        if (row.index_name !== REQUIRED_INDEXES[index] || !row.valid) return true;
        if (row.index_name === "ambient_bridge_commands_delivery_idx") {
          return row.relation !== "ambient_bridge_commands"
            || row.unique_index
            || row.predicate !== null
            || !/\(device_id, status, created_at, id\)/.test(row.definition);
        }
        if (row.index_name === "ambient_bridge_commands_request_unique_idx") {
          return row.relation !== "ambient_bridge_commands"
            || !row.unique_index
            || !/request_id IS NOT NULL/.test(row.predicate ?? "")
            || !/\(device_id, request_id\)/.test(row.definition);
        }
        return row.relation !== "ambient_bridge_rate_limits"
          || row.unique_index
          || row.predicate !== null
          || !/\(scope, reset_at\)/.test(row.definition);
      })) {
      throw new BridgeSchemaMigrationError("The private bridge schema is missing required indexes.");
    }
  } catch (error) {
    if (error instanceof BridgeSchemaMigrationError) throw error;
    throw new BridgeSchemaMigrationError("PostgreSQL bridge schema verification failed.", { cause: error });
  }
}

/** Runtime readiness verifies both the exact schema and the connected least-privilege identity. */
export async function verifyPostgresBridgeSchema(client: PoolClient): Promise<void> {
  await verifyPostgresBridgeLayout(client);
  await verifyPostgresBridgeRuntimeRole(client);
}

interface RuntimeRoleRecord {
  rolname: string;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcanlogin: boolean;
  memberships: number;
}

async function readRuntimeRole(client: PoolClient, runtimeRole?: string): Promise<RuntimeRoleRecord> {
  const role = await client.query<RuntimeRoleRecord>(
    `SELECT role_record.rolname, role_record.rolsuper, role_record.rolcreatedb,
            role_record.rolcreaterole, role_record.rolreplication, role_record.rolbypassrls,
            role_record.rolinherit, role_record.rolcanlogin,
            (SELECT count(*)::integer
               FROM pg_catalog.pg_auth_members AS membership
              WHERE membership.member = role_record.oid) AS memberships
       FROM pg_catalog.pg_roles AS role_record
      WHERE role_record.rolname = COALESCE($1, current_user)`,
    [runtimeRole ?? null],
  );
  const roleRecord = role.rows[0];
  if (!roleRecord) {
    throw new BridgeSchemaMigrationError("The configured Project Ambient runtime database role does not exist.");
  }
  if (roleRecord.rolname === "public"
    || roleRecord.rolname === "postgres"
    || roleRecord.rolname.startsWith("pg_")
    || roleRecord.rolname.startsWith("supabase_")
    || SUPABASE_EXPOSED_ROLES.includes(roleRecord.rolname as typeof SUPABASE_EXPOSED_ROLES[number])) {
    throw new BridgeSchemaMigrationError("The Project Ambient runtime database role is reserved or exposed.");
  }
  if (roleRecord.rolsuper
    || roleRecord.rolcreatedb
    || roleRecord.rolcreaterole
    || roleRecord.rolreplication
    || roleRecord.rolbypassrls
    || roleRecord.rolinherit
    || !roleRecord.rolcanlogin
    || roleRecord.memberships !== 0) {
    throw new BridgeSchemaMigrationError("The Project Ambient runtime database role is not least privileged.");
  }
  return roleRecord;
}

async function verifyPostgresBridgeRuntimeRole(
  client: PoolClient,
  expectedRuntimeRole?: string,
): Promise<void> {
  const roleRecord = await readRuntimeRole(client, expectedRuntimeRole);
  const runtimeRole = roleRecord.rolname;
  const database = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
  const databaseName = database.rows[0]?.database_name;
  if (!databaseName) throw new BridgeSchemaMigrationError("Could not determine the migration database.");
  const authority = await client.query<{
    owns_relation: boolean;
    database_create: boolean;
    schema_create: boolean;
    has_connect: boolean;
    has_schema_usage: boolean;
    has_ledger_select: boolean;
    has_ledger_write: boolean;
    has_devices_dml: boolean;
    has_devices_excess: boolean;
    has_commands_dml: boolean;
    has_commands_excess: boolean;
    has_rate_limits_dml: boolean;
    has_rate_limits_excess: boolean;
    has_rate_state_dml: boolean;
    has_rate_state_excess: boolean;
  }>(
    `SELECT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_class AS class
                JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
               WHERE namespace.nspname = $2
                 AND class.relname = ANY($3::text[])
                 AND class.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
            ) AS owns_relation,
            pg_catalog.has_database_privilege($1, $4, 'CREATE') AS database_create,
            pg_catalog.has_schema_privilege($1, $2, 'CREATE') AS schema_create,
            pg_catalog.has_database_privilege($1, $4, 'CONNECT') AS has_connect,
            pg_catalog.has_schema_privilege($1, $2, 'USAGE') AS has_schema_usage,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_schema_migrations', 'SELECT') AS has_ledger_select,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_schema_migrations', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS has_ledger_write,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_devices', 'SELECT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_devices', 'INSERT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_devices', 'UPDATE') AS has_devices_dml,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_devices', 'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS has_devices_excess,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_commands', 'SELECT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_commands', 'INSERT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_commands', 'UPDATE') AS has_commands_dml,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_commands', 'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS has_commands_excess,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limits', 'SELECT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limits', 'INSERT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limits', 'UPDATE')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limits', 'DELETE') AS has_rate_limits_dml,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limits', 'TRUNCATE,REFERENCES,TRIGGER') AS has_rate_limits_excess,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limit_state', 'SELECT')
              AND pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limit_state', 'UPDATE') AS has_rate_state_dml,
            pg_catalog.has_table_privilege($1, 'ambient_private.ambient_bridge_rate_limit_state', 'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS has_rate_state_excess`,
    [runtimeRole, POSTGRES_BRIDGE_SCHEMA, [...EXPECTED_RELATIONS], databaseName],
  );
  const row = authority.rows[0];
  if (!row
    || row.owns_relation
    || row.database_create
    || row.schema_create
    || !row.has_connect
    || !row.has_schema_usage
    || !row.has_ledger_select
    || row.has_ledger_write
    || !row.has_devices_dml
    || row.has_devices_excess
    || !row.has_commands_dml
    || row.has_commands_excess
    || !row.has_rate_limits_dml
    || row.has_rate_limits_excess
    || !row.has_rate_state_dml
    || row.has_rate_state_excess) {
    throw new BridgeSchemaMigrationError("The Project Ambient runtime database role has invalid privileges.");
  }
}

export async function grantPostgresBridgeRuntimeRole(
  client: PoolClient,
  runtimeRole: string,
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
    throw new BridgeSchemaMigrationError(
      "AMBIENT_RUNTIME_DB_ROLE must be a lowercase PostgreSQL identifier.",
    );
  }
  if (runtimeRole === "public"
    || runtimeRole === "postgres"
    || runtimeRole.startsWith("pg_")
    || runtimeRole.startsWith("supabase_")
    || SUPABASE_EXPOSED_ROLES.includes(runtimeRole as typeof SUPABASE_EXPOSED_ROLES[number])) {
    throw new BridgeSchemaMigrationError("AMBIENT_RUNTIME_DB_ROLE is a reserved or exposed role.");
  }
  const roleRecord = await readRuntimeRole(client, runtimeRole);
  const quotedRole = `"${runtimeRole.replaceAll('"', '""')}"`;
  const database = await client.query<{ database_name: string }>(
    "SELECT current_database() AS database_name",
  );
  const databaseName = database.rows[0]?.database_name;
  if (!databaseName) throw new BridgeSchemaMigrationError("Could not determine the migration database.");
  const quotedDatabase = `"${databaseName.replaceAll('"', '""')}"`;
  const migrationIdentity = await client.query<{ current_user: string; session_user: string }>(
    "SELECT current_user, session_user",
  );
  if (migrationIdentity.rows[0]?.current_user === runtimeRole
    || migrationIdentity.rows[0]?.session_user === runtimeRole) {
    throw new BridgeSchemaMigrationError("The runtime and migration database roles must be different.");
  }
  await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quotedDatabase} FROM ${quotedRole}`);
  await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole}`);
  await client.query(`REVOKE ALL ON SCHEMA ${PRIVATE_SCHEMA} FROM ${quotedRole}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${PRIVATE_SCHEMA} FROM ${quotedRole}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${PRIVATE_SCHEMA} FROM ${quotedRole}`);
  await client.query(`GRANT USAGE ON SCHEMA ${PRIVATE_SCHEMA} TO ${quotedRole}`);
  await client.query(
    `GRANT SELECT ON TABLE ${PRIVATE_SCHEMA}."ambient_bridge_schema_migrations" TO ${quotedRole}`,
  );
  await client.query(
    `GRANT SELECT, INSERT, UPDATE ON TABLE
       ${PRIVATE_SCHEMA}."ambient_bridge_devices",
       ${PRIVATE_SCHEMA}."ambient_bridge_commands"
     TO ${quotedRole}`,
  );
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
       ${PRIVATE_SCHEMA}."ambient_bridge_rate_limits"
     TO ${quotedRole}`,
  );
  await client.query(
    `GRANT SELECT, UPDATE ON TABLE
       ${PRIVATE_SCHEMA}."ambient_bridge_rate_limit_state"
     TO ${quotedRole}`,
  );
  await verifyPostgresBridgeRuntimeRole(client, roleRecord.rolname);
}

export async function migratePostgresBridge(
  client: PoolClient,
  options: { runtimeRole?: string } = {},
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [...POSTGRES_BRIDGE_MIGRATION_LOCK]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${PRIVATE_SCHEMA}`);
    await moveLegacyPublicLayout(client);
    await revokeExposedRoleAccess(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ambient_private"."ambient_bridge_schema_migrations" (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const applied = await client.query<{ version: number; name: string }>(
      `SELECT version, name
         FROM "ambient_private"."ambient_bridge_schema_migrations"
        ORDER BY version ASC`,
    );
    const currentVersion = validateAppliedVersions(applied.rows);
    for (const migration of POSTGRES_BRIDGE_MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO "ambient_private"."ambient_bridge_schema_migrations" (version, name, applied_at)
         VALUES ($1, $2, clock_timestamp())`,
        [migration.version, migration.name],
      );
    }
    await revokeExposedRoleAccess(client);
    if (options.runtimeRole) await grantPostgresBridgeRuntimeRole(client, options.runtimeRole);
    await verifyPostgresBridgeLayout(client);
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
