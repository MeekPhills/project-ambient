import {
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUUID,
} from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { migratePostgresBridge } from "./postgres-migrations.js";
import { PostgresBridgeStore } from "./postgres-store.js";
import {
  derivePostgresScramVerifier,
  generateRuntimePassword,
  isPostgresScramVerifier,
} from "./scram.js";

export const AMBIENT_RUNTIME_ROLE = "ambient_runtime" as const;
export const AMBIENT_SUPABASE_PROJECT_REF = "mbcxfyekqyexpqshamwq" as const;

const POOLER_HOST_PATTERN = /^aws-[0-9]+-us-east-1\.pooler\.supabase\.com$/;

export type SupabaseAdminCredentialMode = "jit" | "password";

export interface SupabaseBootstrapConfig {
  poolerHost: string;
  credentialMode: SupabaseAdminCredentialMode;
  execute: boolean;
}

export interface SupabaseBootstrapPlan {
  mode: "dry-run" | "execute";
  adminEndpoint: string;
  adminUsername: string;
  adminCredential: "temporary-access-token" | "database-password";
  runtimeEndpoint: string;
  runtimeUsername: string;
  runtimeDatabaseRole: typeof AMBIENT_RUNTIME_ROLE;
  migration: "in-process";
  secretSink: "required-for-live-library-call";
}

export interface RuntimeSecretPayload {
  postgresUrl: string;
}

export type RuntimeSecretSinkErrorOutcome = "definite-failure" | "ambiguous";

export interface SupabaseBootstrapDependencies {
  createPool?: (config: PoolConfig) => Pool;
  migrate?: typeof migratePostgresBridge;
  initializeRuntime?: (pool: Pool) => Promise<void>;
  randomBytes?: (size: number) => Buffer;
  randomUUID?: () => string;
  delay?: (milliseconds: number) => Promise<void>;
  secretSink?: (payload: RuntimeSecretPayload) => Promise<{
    outcome: "confirmed";
  }>;
}

const RUNTIME_CONNECT_ATTEMPTS = 3;
const RUNTIME_CONNECT_RETRY_DELAY_MS = 30_000;
const BOOTSTRAP_PREFLIGHT_STATEMENT_TIMEOUT_MS = 15_000;

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isTransientRuntimeConnectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "53300", "57P03", "08000", "08001", "08003", "08004", "08006", "08007", "08P01"].includes(code)) {
    return true;
  }
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return /(?:password authentication failed|tenant or user not found|connection terminated unexpectedly|server closed the connection unexpectedly)/.test(
    message,
  );
}

function isAmbiguousRoleCreationError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const code = "code" in current ? String(current.code) : "";
    if (/^08/.test(code) || [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EPIPE",
      "57P01",
      "57P02",
    ].includes(code)) return true;
    const message = "message" in current ? String(current.message).toLowerCase() : "";
    if (/(?:connection terminated unexpectedly|server closed the connection unexpectedly|connection reset|socket hang up|broken pipe)/.test(
      message,
    )) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function connectRuntimeWithRetry(
  pool: Pool,
  delay: (milliseconds: number) => Promise<void>,
): Promise<PoolClient> {
  for (let attempt = 1; attempt <= RUNTIME_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      if (!isTransientRuntimeConnectError(error)) {
        throw error;
      }
      if (attempt === RUNTIME_CONNECT_ATTEMPTS) {
        throw new SupabaseBootstrapError(
          "The shared-pooler runtime connection did not propagate after 3 total attempts.",
        );
      }
      await delay(RUNTIME_CONNECT_RETRY_DELAY_MS);
    }
  }
  throw new SupabaseBootstrapError("The runtime connection retry budget was exhausted.");
}

export class SupabaseBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseBootstrapError";
  }
}

function assertConfig(config: SupabaseBootstrapConfig): void {
  if (!POOLER_HOST_PATTERN.test(config.poolerHost)) {
    throw new SupabaseBootstrapError(
      "The pooler host must be an aws-N-us-east-1.pooler.supabase.com hostname.",
    );
  }
  if (config.credentialMode !== "jit" && config.credentialMode !== "password") {
    throw new SupabaseBootstrapError("The administrator credential mode is invalid.");
  }
}

export function planSupabaseBootstrap(
  config: SupabaseBootstrapConfig,
): SupabaseBootstrapPlan {
  assertConfig(config);
  return {
    mode: config.execute ? "execute" : "dry-run",
    adminEndpoint: `${config.poolerHost}:5432/postgres`,
    adminUsername: `postgres.${AMBIENT_SUPABASE_PROJECT_REF}`,
    adminCredential: config.credentialMode === "jit"
      ? "temporary-access-token"
      : "database-password",
    runtimeEndpoint: `${config.poolerHost}:6543/postgres`,
    runtimeUsername: `${AMBIENT_RUNTIME_ROLE}.${AMBIENT_SUPABASE_PROJECT_REF}`,
    runtimeDatabaseRole: AMBIENT_RUNTIME_ROLE,
    migration: "in-process",
    secretSink: "required-for-live-library-call",
  };
}

export function buildAdminPoolConfig(
  config: SupabaseBootstrapConfig,
  administratorCredential: string,
): PoolConfig {
  assertConfig(config);
  if (administratorCredential.length === 0 || administratorCredential.includes("\0")) {
    throw new SupabaseBootstrapError("The Supabase administrator credential is invalid.");
  }
  return {
    host: config.poolerHost,
    port: 5_432,
    database: "postgres",
    user: `postgres.${AMBIENT_SUPABASE_PROJECT_REF}`,
    password: administratorCredential,
    ssl: { rejectUnauthorized: true },
    options: config.credentialMode === "jit" ? "-c jit=true" : undefined,
    max: 1,
    connectionTimeoutMillis: 10_000,
    // Bounds the identity and role-existence preflight. The migration starts
    // its own transaction and deliberately raises this locally to 120 seconds.
    statement_timeout: BOOTSTRAP_PREFLIGHT_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 1_000,
    application_name: "project-ambient-bootstrap-migrator",
  };
}

export function buildRuntimePoolConfig(
  config: SupabaseBootstrapConfig,
  runtimePassword: string,
): PoolConfig {
  assertConfig(config);
  if (!/^[A-Za-z0-9_-]{64}$/.test(runtimePassword)) {
    throw new SupabaseBootstrapError("The generated runtime password is invalid.");
  }
  return {
    host: config.poolerHost,
    port: 6_543,
    database: "postgres",
    user: `${AMBIENT_RUNTIME_ROLE}.${AMBIENT_SUPABASE_PROJECT_REF}`,
    password: runtimePassword,
    ssl: { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 10_000,
    // Bounds the runtime identity/readiness checks. The rollback-only smoke
    // uses its stricter transaction-local 10-second deadline.
    statement_timeout: BOOTSTRAP_PREFLIGHT_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 1_000,
    application_name: "project-ambient-bootstrap-runtime-smoke",
  };
}

export function buildRuntimePostgresUrl(
  config: SupabaseBootstrapConfig,
  runtimePassword: string,
): string {
  buildRuntimePoolConfig(config, runtimePassword);
  const url = new URL("postgresql://placeholder.invalid/postgres");
  url.username = `${AMBIENT_RUNTIME_ROLE}.${AMBIENT_SUPABASE_PROJECT_REF}`;
  url.password = runtimePassword;
  url.hostname = config.poolerHost;
  url.port = "6543";
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

export function buildCreateRuntimeRoleSql(verifier: string): string {
  if (!isPostgresScramVerifier(verifier)) {
    throw new SupabaseBootstrapError("The generated PostgreSQL verifier is invalid.");
  }
  // The role identifier is a compile-time constant and the verifier alphabet
  // cannot contain a quote. The plaintext password never enters SQL.
  return `CREATE ROLE "${AMBIENT_RUNTIME_ROLE}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`;
}

async function rejectExistingRuntimeRole(client: PoolClient): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS exists",
    [AMBIENT_RUNTIME_ROLE],
  );
  const exists = result.rows[0]?.exists;
  if (typeof exists !== "boolean") {
    throw new SupabaseBootstrapError("The runtime-role preflight returned an invalid result.");
  }
  if (exists) {
    throw new SupabaseBootstrapError(
      `Database role ${AMBIENT_RUNTIME_ROLE} already exists; refusing to rotate it implicitly.`,
    );
  }
}

async function verifyAdministratorIdentity(client: PoolClient): Promise<void> {
  const identity = await client.query<{ current_user: string; session_user: string }>(
    "SELECT current_user, session_user",
  );
  if (
    identity.rows[0]?.current_user !== "postgres"
    || identity.rows[0]?.session_user !== "postgres"
  ) {
    throw new SupabaseBootstrapError(
      "The session-pooler connection did not resolve to the fixed postgres administrator role.",
    );
  }
}

async function cleanupRuntimeRole(client: PoolClient): Promise<void> {
  // This path is reachable only before the single migration transaction has
  // committed, so the fresh role cannot own or retain bridge objects/grants.
  await client.query(`DROP ROLE IF EXISTS "${AMBIENT_RUNTIME_ROLE}"`);
}

async function disableRuntimeRoleLogin(client: PoolClient): Promise<void> {
  await client.query(`ALTER ROLE "${AMBIENT_RUNTIME_ROLE}" NOLOGIN`);
}

async function defaultInitializeRuntime(pool: Pool): Promise<void> {
  const store = new PostgresBridgeStore(
    { connectionString: "postgresql://bootstrap.invalid/postgres" },
    pool,
  );
  await store.initialize();
}

async function verifyRuntimeIdentity(client: PoolClient): Promise<void> {
  const identity = await client.query<{ current_user: string; session_user: string }>(
    "SELECT current_user, session_user",
  );
  const row = identity.rows[0];
  if (
    row?.current_user !== AMBIENT_RUNTIME_ROLE
    || row.session_user !== AMBIENT_RUNTIME_ROLE
  ) {
    throw new SupabaseBootstrapError(
      "The shared-pooler session did not resolve to the expected runtime role.",
    );
  }
}

export async function runRollbackOnlyRuntimeSmoke(
  client: PoolClient,
  uniqueId: string = nodeRandomUUID(),
): Promise<void> {
  const suffix = uniqueId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  if (suffix.length < 8) {
    throw new SupabaseBootstrapError("The runtime smoke identifier is invalid.");
  }
  const deviceId = `bootstrap-smoke-device-${suffix}`;
  const commandId = `bootstrap-smoke-command-${suffix}`;
  const keyHash = `bootstrap-smoke-rate-limit-key-${suffix}`;
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query(
      `INSERT INTO "ambient_private"."ambient_bridge_devices"
         (device_id, display_name, token_hash, enrolled_at, last_seen_at, revoked_at)
       VALUES ($1, 'Bootstrap smoke (always rolled back)', $2, clock_timestamp(), NULL, NULL)`,
      [deviceId, `bootstrap-smoke-token-hash-${suffix}`],
    );
    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_devices"
          SET last_seen_at = clock_timestamp()
        WHERE device_id = $1`,
      [deviceId],
    );
    await client.query(
      `INSERT INTO "ambient_private"."ambient_bridge_commands"
         (id, device_id, operation, status, created_at, expires_at,
          lease_expires_at, result, error, lease_id, request_id,
          protocol_version, attempt_count, max_attempts)
       VALUES ($1, $2, '{"type":"get_status"}'::jsonb, 'pending',
               clock_timestamp(), clock_timestamp() + INTERVAL '1 minute',
               NULL, NULL, NULL, NULL, NULL, 2, 0, 3)`,
      [commandId, deviceId],
    );
    const commandLock = await client.query(
      `SELECT id FROM "ambient_private"."ambient_bridge_commands"
        WHERE id = $1 FOR UPDATE`,
      [commandId],
    );
    if ((commandLock.rowCount ?? 0) !== 1) {
      throw new SupabaseBootstrapError("The rollback-only command lock smoke failed.");
    }
    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_commands"
          SET expires_at = expires_at
        WHERE id = $1`,
      [commandId],
    );
    const stateLock = await client.query(
      `SELECT active_keys
         FROM "ambient_private"."ambient_bridge_rate_limit_state"
        WHERE scope = 'ingress' FOR UPDATE`,
    );
    if ((stateLock.rowCount ?? 0) !== 1) {
      throw new SupabaseBootstrapError("The rollback-only rate-limit lock smoke failed.");
    }
    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_rate_limit_state"
          SET active_keys = active_keys
        WHERE scope = 'ingress'`,
    );
    await client.query(
      `INSERT INTO "ambient_private"."ambient_bridge_rate_limits"
         (scope, key_hash, total_hits, reset_at)
       VALUES ('ingress', $1, 1, clock_timestamp() + INTERVAL '1 minute')`,
      [keyHash],
    );
    await client.query(
      `UPDATE "ambient_private"."ambient_bridge_rate_limits"
          SET total_hits = total_hits + 1
        WHERE scope = 'ingress' AND key_hash = $1`,
      [keyHash],
    );
    await client.query(
      `DELETE FROM "ambient_private"."ambient_bridge_rate_limits"
        WHERE scope = 'ingress' AND key_hash = $1`,
      [keyHash],
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the smoke-test failure. Closing the pool discards this session.
      }
    }
  }
}

/**
 * Perform the privileged, one-shot bootstrap. All credentials remain in memory,
 * and the generated URL is consumed directly by the injected fixed secret sink.
 */
export async function executeSupabaseBootstrap(
  config: SupabaseBootstrapConfig,
  administratorCredential: string,
  dependencies: SupabaseBootstrapDependencies = {},
): Promise<void> {
  assertConfig(config);
  if (!config.execute) {
    throw new SupabaseBootstrapError("A dry-run configuration cannot execute bootstrap.");
  }
  if (!dependencies.secretSink) {
    throw new SupabaseBootstrapError("Live bootstrap requires an injected in-process secret sink.");
  }
  const createPool = dependencies.createPool ?? ((poolConfig) => new Pool(poolConfig));
  const migrate = dependencies.migrate ?? migratePostgresBridge;
  const initializeRuntime = dependencies.initializeRuntime ?? defaultInitializeRuntime;
  const delay = dependencies.delay ?? defaultDelay;
  const runtimePassword = generateRuntimePassword(dependencies.randomBytes);
  const verifier = derivePostgresScramVerifier(runtimePassword);
  const adminPool = createPool(buildAdminPoolConfig(config, administratorCredential));
  administratorCredential = "";
  let runtimePool: Pool | undefined;
  let adminClient: PoolClient | undefined;
  let runtimeClient: PoolClient | undefined;
  let roleCreateOutcome: "not-sent" | "acknowledged" | "ambiguous" = "not-sent";
  let roleCreationAmbiguous = false;
  let migrationCommitted = false;
  let migrationCompletionAmbiguous = false;
  let completed = false;
  let adminPoolEnded = false;
  const failureState: { sinkOutcome?: RuntimeSecretSinkErrorOutcome } = {};
  let pendingError: unknown;

  try {
    try {
      adminClient = await adminPool.connect();
    } catch {
      throw new SupabaseBootstrapError("The Supabase administrator connection failed.");
    }

    try {
      await verifyAdministratorIdentity(adminClient);
      await rejectExistingRuntimeRole(adminClient);
    } catch (error) {
      if (error instanceof SupabaseBootstrapError) throw error;
      throw new SupabaseBootstrapError("The runtime-role preflight failed.");
    }
    try {
      try {
        await adminClient.query(buildCreateRuntimeRoleSql(verifier));
        roleCreateOutcome = "acknowledged";
      } catch (error) {
        if (isAmbiguousRoleCreationError(error)) {
          roleCreateOutcome = "ambiguous";
          roleCreationAmbiguous = true;
        }
        throw error;
      }
      await migrate(adminClient, { runtimeRole: AMBIENT_RUNTIME_ROLE });
      migrationCommitted = true;
    } catch (error) {
      if (roleCreateOutcome === "acknowledged" && isAmbiguousRoleCreationError(error)) {
        migrationCompletionAmbiguous = true;
      }
      if (error instanceof SupabaseBootstrapError) throw error;
      throw new SupabaseBootstrapError(
        "The private-schema migration failed; inspect ambient_runtime and ambient_private before retrying.",
      );
    }

    runtimePool = createPool(buildRuntimePoolConfig(config, runtimePassword));
    try {
      runtimeClient = await connectRuntimeWithRetry(runtimePool, delay);
      await verifyRuntimeIdentity(runtimeClient);
      runtimeClient.release();
      runtimeClient = undefined;
      await initializeRuntime(runtimePool);
      runtimeClient = await runtimePool.connect();
      await runRollbackOnlyRuntimeSmoke(
        runtimeClient,
        (dependencies.randomUUID ?? nodeRandomUUID)(),
      );
      runtimeClient.release();
      runtimeClient = undefined;
      await runtimePool.end();
      runtimePool = undefined;
    } catch (error) {
      if (error instanceof SupabaseBootstrapError) throw error;
      throw new SupabaseBootstrapError("The least-privilege runtime verification failed.");
    }

    const runtimeUrl = buildRuntimePostgresUrl(config, runtimePassword);
    try {
      const sinkResult = await dependencies.secretSink({ postgresUrl: runtimeUrl });
      if (
        !sinkResult
        || typeof sinkResult !== "object"
        || sinkResult.outcome !== "confirmed"
      ) {
        failureState.sinkOutcome = "ambiguous";
        throw new SupabaseBootstrapError(
          "The in-process runtime secret sink returned an unconfirmed result.",
        );
      }
    } catch (error) {
      failureState.sinkOutcome ??= error
          && typeof error === "object"
          && "outcome" in error
          && error.outcome === "definite-failure"
        ? "definite-failure"
        : "ambiguous";
      throw new SupabaseBootstrapError("The in-process runtime secret sink failed.");
    }

    completed = true;
  } catch (error) {
    if (migrationCommitted) {
      let loginDisabled = false;
      if (adminClient) {
        try {
          await disableRuntimeRoleLogin(adminClient);
          loginDisabled = true;
        } catch {
          adminClient.release(true);
          adminClient = undefined;
          try {
            const containmentClient = await adminPool.connect();
            try {
              await verifyAdministratorIdentity(containmentClient);
              await disableRuntimeRoleLogin(containmentClient);
              loginDisabled = true;
            } finally {
              containmentClient.release();
            }
          } catch {
            // The fixed message below reports that containment could not be confirmed.
          }
        }
      }
      if (loginDisabled) {
        if (failureState.sinkOutcome === "definite-failure") {
          throw new SupabaseBootstrapError(
            "The Vercel secret write definitely failed; ambient_runtime was preserved with LOGIN disabled (NOLOGIN).",
          );
        }
        if (failureState.sinkOutcome === "ambiguous") {
          throw new SupabaseBootstrapError(
            "The Vercel secret-write outcome is ambiguous; ambient_runtime was preserved with LOGIN disabled (NOLOGIN).",
          );
        }
        throw new SupabaseBootstrapError(
          "Bootstrap failed after migration committed; ambient_runtime was preserved with LOGIN disabled (NOLOGIN).",
        );
      }
      if (failureState.sinkOutcome === "definite-failure") {
        throw new SupabaseBootstrapError(
          "The Vercel secret write definitely failed; ambient_runtime was preserved, but containment could not be confirmed.",
        );
      }
      if (failureState.sinkOutcome === "ambiguous") {
        throw new SupabaseBootstrapError(
          "The Vercel secret-write outcome is ambiguous; ambient_runtime was preserved, but containment could not be confirmed.",
        );
      }
      throw new SupabaseBootstrapError(
        "Bootstrap failed after migration committed; ambient_runtime was preserved, but containment could not be confirmed.",
      );
    }
    throw error;
  } finally {
    runtimeClient?.release();
    if (runtimePool) {
      try {
        await runtimePool.end();
      } catch {
        // Cleanup continues through the privileged connection.
      }
    }
    if (
      !completed
      && roleCreateOutcome === "acknowledged"
      && !migrationCommitted
      && !migrationCompletionAmbiguous
      && adminClient
    ) {
      try {
        await cleanupRuntimeRole(adminClient);
      } catch {
        try {
          await disableRuntimeRoleLogin(adminClient);
          pendingError = new SupabaseBootstrapError(
            "Bootstrap migration completion is uncertain; ambient_runtime could not be dropped and was preserved with LOGIN disabled (NOLOGIN).",
          );
        } catch {
          pendingError = new SupabaseBootstrapError(
            "Bootstrap migration completion is uncertain; ambient_runtime could not be dropped and containment could not be confirmed.",
          );
        }
      }
    }
    if (
      !completed
      && (roleCreationAmbiguous || migrationCompletionAmbiguous)
      && !migrationCommitted
    ) {
      adminClient?.release(true);
      adminClient = undefined;
      try {
        const containmentClient = await adminPool.connect();
        try {
          await verifyAdministratorIdentity(containmentClient);
          await disableRuntimeRoleLogin(containmentClient);
        } finally {
          containmentClient.release();
        }
        pendingError = new SupabaseBootstrapError(
          "Runtime-role or migration completion is uncertain; no role was dropped and ambient_runtime LOGIN was disabled if the role exists.",
        );
      } catch {
        pendingError = new SupabaseBootstrapError(
          "Runtime-role or migration completion is uncertain; no role was dropped and containment could not be confirmed.",
        );
      }
    }
    adminClient?.release();
    if (!adminPoolEnded) {
      try {
        await adminPool.end();
      } catch {
        // Pools are best-effort cleanup after the actionable result is known.
      }
    }
    if (pendingError) throw pendingError;
  }
}

export function safeBootstrapErrorMessage(error: unknown): string {
  return error instanceof SupabaseBootstrapError
    ? error.message
    : "Supabase bootstrap failed without exposing diagnostic credentials.";
}
