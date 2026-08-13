import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool, PoolClient, PoolConfig, QueryResult } from "pg";
import type { ReadStream, WriteStream } from "node:tty";
import {
  AMBIENT_RUNTIME_ROLE,
  AMBIENT_SUPABASE_PROJECT_REF,
  buildAdminPoolConfig,
  buildCreateRuntimeRoleSql,
  buildRuntimePostgresUrl,
  executeSupabaseBootstrap,
  planSupabaseBootstrap,
  SupabaseBootstrapError,
  type SupabaseBootstrapDependencies,
  type SupabaseBootstrapConfig,
  type RuntimeSecretPayload,
} from "../src/bridge/supabase-bootstrap.js";
import {
  derivePostgresScramVerifier,
  generateRuntimePassword,
  isPostgresScramVerifier,
} from "../src/bridge/scram.js";
import {
  assertSafeBootstrapEnvironment,
  parseSupabaseBootstrapArgs,
  readHiddenTtyLine,
  readVisibleTtyLine,
  runSupabaseOwnerBootstrap,
  SUPABASE_OWNER_CONFIRMATION_PHRASE,
  SUPABASE_BOOTSTRAP_HELP,
} from "../src/supabase-bootstrap.js";

const PROJECT_REF = AMBIENT_SUPABASE_PROJECT_REF;
const POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com";
const ADMIN_SECRET = "temporary-owner-secret-never-log";

function config(overrides: Partial<SupabaseBootstrapConfig> = {}): SupabaseBootstrapConfig {
  return {
    poolerHost: POOLER_HOST,
    credentialMode: "jit",
    execute: false,
    ...overrides,
  };
}

test("derives a deterministic PostgreSQL SCRAM-SHA-256 verifier", () => {
  const verifier = derivePostgresScramVerifier("correct horse battery staple", {
    salt: Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"),
    iterations: 4_096,
  });
  assert.equal(
    verifier,
    "SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$ONYbSJBXtKl6bP6PVqw8pm9e7EiacprLnoUQPFS80Hw=:IPOtHuGJ2HifEQg74W2XXqqCrCyQG55GbPRHa6g6n9w=",
  );
  assert.equal(isPostgresScramVerifier(verifier), true);
  assert.equal(isPostgresScramVerifier("SCRAM-SHA-256$4096:bad"), false);
});

test("generates a 48-byte base64url password and best-effort zeroes its source", () => {
  const source = Buffer.alloc(48, 0x7f);
  const password = generateRuntimePassword(() => source);
  assert.match(password, /^[A-Za-z0-9_-]{64}$/);
  assert.deepEqual(source, Buffer.alloc(48));
});

test("role SQL contains only a verifier and exact least-privilege flags", () => {
  const plaintext = "never-include-this-password";
  const verifier = derivePostgresScramVerifier(plaintext, {
    salt: Buffer.alloc(16, 4),
  });
  const sql = buildCreateRuntimeRoleSql(verifier);
  assert.match(sql, /^CREATE ROLE "ambient_runtime" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'SCRAM-SHA-256\$/);
  assert.equal(sql.includes(plaintext), false);
  assert.throws(() => buildCreateRuntimeRoleSql(`x' ${verifier}`), SupabaseBootstrapError);
});

test("strictly validates Supabase endpoints and keeps the admin secret out of URLs", () => {
  const live = config({ execute: true });
  const admin = buildAdminPoolConfig(live, ADMIN_SECRET);
  assert.equal(admin.host, POOLER_HOST);
  assert.equal(admin.port, 5_432);
  assert.equal(admin.user, `postgres.${PROJECT_REF}`);
  assert.equal(admin.password, ADMIN_SECRET);
  assert.equal(admin.options, "-c jit=true");
  assert.equal(admin.statement_timeout, 15_000);
  assert.equal("connectionString" in admin, false);

  const runtimePassword = "a".repeat(64);
  const runtimeUrl = new URL(buildRuntimePostgresUrl(live, runtimePassword));
  assert.equal(runtimeUrl.hostname, POOLER_HOST);
  assert.equal(runtimeUrl.port, "6543");
  assert.equal(runtimeUrl.username, `${AMBIENT_RUNTIME_ROLE}.${PROJECT_REF}`);
  assert.equal(runtimeUrl.searchParams.get("sslmode"), "verify-full");

  for (const invalid of [
    config({ poolerHost: "evil.example.com" }),
    config({ poolerHost: "aws-0-us-west-2.pooler.supabase.com" }),
    config({ poolerHost: "aws-0-us-east-1.pooler.supabase.com.evil.test" }),
  ]) {
    assert.throws(() => planSupabaseBootstrap(invalid), SupabaseBootstrapError);
  }
});

test("dry-run is mutation-free and contains only redacted topology", () => {
  const plan = planSupabaseBootstrap(config());
  assert.deepEqual(plan, {
    mode: "dry-run",
    adminEndpoint: `${POOLER_HOST}:5432/postgres`,
    adminUsername: `postgres.${PROJECT_REF}`,
    adminCredential: "temporary-access-token",
    runtimeEndpoint: `${POOLER_HOST}:6543/postgres`,
    runtimeUsername: `${AMBIENT_RUNTIME_ROLE}.${PROJECT_REF}`,
    runtimeDatabaseRole: AMBIENT_RUNTIME_ROLE,
    migration: "in-process",
    secretSink: "required-for-live-library-call",
  });
  assert.equal(JSON.stringify(plan).includes(ADMIN_SECRET), false);
});

test("CLI accepts no secret argv and rejects risky environment hooks before prompting", () => {
  assert.equal(parseSupabaseBootstrapArgs(["--help"]).help, true);
  assert.match(SUPABASE_BOOTSTRAP_HELP, /validates and prints only a fixed, redacted/);
  assert.match(SUPABASE_BOOTSTRAP_HELP, /in-process HTTPS fetch/);
  const parsed = parseSupabaseBootstrapArgs([
    "--pooler-host", POOLER_HOST,
  ]);
  assert.equal(parsed.help, false);
  if (!parsed.help) assert.equal(parsed.config.execute, false);
  const liveParsed = parseSupabaseBootstrapArgs([
    "--pooler-host", POOLER_HOST,
    "--execute",
  ]);
  assert.equal(liveParsed.help, false);
  if (!liveParsed.help) assert.equal(liveParsed.config.execute, true);
  assert.throws(
    () => parseSupabaseBootstrapArgs([
      "--pooler-host", POOLER_HOST,
      "--password", ADMIN_SECRET,
    ]),
    (error: unknown) => error instanceof Error && !error.message.includes(ADMIN_SECRET),
  );
  assert.throws(
    () => parseSupabaseBootstrapArgs([
      "--pooler-host", POOLER_HOST,
      ADMIN_SECRET,
    ]),
    (error: unknown) => error instanceof Error && !error.message.includes(ADMIN_SECRET),
  );
  assert.throws(
    () => parseSupabaseBootstrapArgs([
      "--project-ref", "00000000000000000000",
      "--pooler-host", POOLER_HOST,
    ]),
    /Unsupported command-line option/,
  );
  assert.doesNotThrow(() => assertSafeBootstrapEnvironment({ HOME: "/safe/home" }));
  for (const environment of [
    { NODE_OPTIONS: "--require=/tmp/steal.js" },
    { NODE_PATH: "/tmp/hostile" },
    { PGHOST: "attacker.invalid" },
    { https_proxy: "http://attacker.invalid" },
    { SUPABASE_ACCESS_TOKEN: ADMIN_SECRET },
    { VERCEL_OIDC_TOKEN: ADMIN_SECRET },
  ]) {
    assert.throws(
      () => assertSafeBootstrapEnvironment(environment),
      (error: unknown) => error instanceof Error && !error.message.includes(ADMIN_SECRET),
    );
  }
});

test("owner runner completes Vercel preflight before database prompting, randomness, or SQL", async () => {
  const events: string[] = [];
  let randomCalls = 0;
  let poolCalls = 0;
  let promptCalls = 0;
  await assert.rejects(
    () => runSupabaseOwnerBootstrap(liveConfig(), {
      environment: {},
      readSecret: async () => {
        promptCalls += 1;
        events.push(`prompt-${promptCalls}`);
        return "dedicated-token-sentinel-1234567890";
      },
      createSecretSink: () => ({
        preflight: async () => {
          events.push("preflight");
          throw new SupabaseBootstrapError("fixed preflight failed");
        },
        write: async () => ({ outcome: "confirmed" }),
        dispose: () => { events.push("dispose"); },
      }),
      readConfirmation: async () => {
        events.push("confirmation");
        return SUPABASE_OWNER_CONFIRMATION_PHRASE;
      },
      bootstrap: {
        randomBytes: () => { randomCalls += 1; return Buffer.alloc(48); },
        createPool: () => { poolCalls += 1; throw new Error("must not connect"); },
      },
    }),
    /fixed preflight failed/,
  );
  assert.deepEqual(events, ["prompt-1", "preflight", "dispose"]);
  assert.equal(promptCalls, 1);
  assert.equal(randomCalls, 0);
  assert.equal(poolCalls, 0);
});

test("owner runner requires exact visible confirmation before the database prompt or bootstrap", async () => {
  for (const confirmation of ["", "yes", `${SUPABASE_OWNER_CONFIRMATION_PHRASE} `]) {
    const events: string[] = [];
    let randomCalls = 0;
    await assert.rejects(
      () => runSupabaseOwnerBootstrap(liveConfig(), {
        environment: {},
        readSecret: async () => {
          events.push("secret-prompt");
          return "dedicated-token-sentinel-1234567890";
        },
        readConfirmation: async () => {
          events.push("visible-confirmation");
          return confirmation;
        },
        createSecretSink: () => ({
          preflight: async () => { events.push("preflight"); },
          write: async () => ({ outcome: "confirmed" }),
          dispose: () => { events.push("dispose"); },
        }),
        bootstrap: {
          randomBytes: () => { randomCalls += 1; return Buffer.alloc(48); },
        },
      }),
      /confirmation did not match/,
    );
    assert.deepEqual(events, ["secret-prompt", "preflight", "visible-confirmation", "dispose"]);
    assert.equal(randomCalls, 0);
  }
  await assert.rejects(
    () => readVisibleTtyLine(
      "Confirm: ",
      { isTTY: false } as ReadStream,
      { isTTY: true } as WriteStream,
    ),
    /controlling TTY/,
  );
});

test("owner runner enforces the complete token-preflight-confirm-database-write sequence", async () => {
  const events: string[] = [];
  const prompts: string[] = [];
  const admin = fakeClient((text) => adminQuery(text, false));
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const pools = [fakePool([admin]), fakePool([runtimeIdentity, runtimeSmoke])];
  let poolIndex = 0;
  let secretPrompt = 0;

  await runSupabaseOwnerBootstrap(liveConfig(), {
    environment: {},
    readSecret: async (prompt) => {
      prompts.push(prompt);
      secretPrompt += 1;
      events.push(secretPrompt === 1 ? "token-prompt" : "database-prompt");
      return secretPrompt === 1
        ? "dedicated-token-sentinel-1234567890"
        : ADMIN_SECRET;
    },
    readConfirmation: async (prompt) => {
      prompts.push(prompt);
      events.push("visible-confirmation");
      return SUPABASE_OWNER_CONFIRMATION_PHRASE;
    },
    createSecretSink: () => ({
      preflight: async () => { events.push("preflight"); },
      write: async () => { events.push("vercel-write"); return { outcome: "confirmed" }; },
      dispose: () => { events.push("dispose"); },
    }),
    bootstrap: {
      createPool: () => pools[poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 18),
      randomUUID: () => "00000000-0000-4000-8000-000000000018",
      migrate: async () => { events.push("migration"); },
      initializeRuntime: async () => { events.push("runtime-gates"); },
    },
  });
  assert.deepEqual(events, [
    "token-prompt",
    "preflight",
    "visible-confirmation",
    "database-prompt",
    "migration",
    "runtime-gates",
    "vercel-write",
    "dispose",
  ]);
  assert.equal(prompts.some((prompt) => prompt.includes(SUPABASE_OWNER_CONFIRMATION_PHRASE)), true);
  assert.equal(prompts.some((prompt) => prompt.includes("project-ambient-control")), true);
  assert.equal(prompts.join("\n").includes(ADMIN_SECRET), false);
});

test("hidden input rejects redirected stdin and never echoes the credential", async () => {
  await assert.rejects(
    () => readHiddenTtyLine(
      "Secret: ",
      { isTTY: false } as ReadStream,
      { isTTY: true } as WriteStream,
    ),
    /controlling TTY/,
  );

  const secret = "credential-never-echoed";
  const input = new EventEmitter() as ReadStream;
  let raw = false;
  input.isTTY = true;
  Object.defineProperty(input, "isRaw", { get: () => raw });
  input.setRawMode = ((mode: boolean) => { raw = mode; return input; }) as ReadStream["setRawMode"];
  input.resume = (() => input) as ReadStream["resume"];
  input.pause = (() => input) as ReadStream["pause"];
  const outputText: string[] = [];
  const output = {
    isTTY: true,
    write: (value: string) => { outputText.push(value); return true; },
  } as unknown as WriteStream;
  const pending = readHiddenTtyLine("Secret: ", input, output);
  input.emit("data", Buffer.from(`${secret}\r`));
  assert.equal(await pending, secret);
  assert.equal(outputText.join("").includes(secret), false);
  assert.equal(raw, false);
});

interface FakeClient extends PoolClient {
  readonly calls: string[];
  readonly released: { value: boolean };
}

function fakeClient(
  handler: (text: string, values: unknown[] | undefined) => unknown = () => ({ rows: [], rowCount: 1 }),
): FakeClient {
  const calls: string[] = [];
  const released = { value: false };
  return {
    calls,
    released,
    query: (async (text: string, values?: unknown[]) => {
      calls.push(text);
      return handler(text, values) as QueryResult;
    }) as PoolClient["query"],
    release: () => { released.value = true; },
  } as unknown as FakeClient;
}

function adminQuery(text: string, exists: boolean): QueryResult {
  if (text === "SELECT current_user, session_user") {
    return {
      command: "SELECT",
      oid: 0,
      fields: [],
      rows: [{ current_user: "postgres", session_user: "postgres" }],
      rowCount: 1,
    };
  }
  if (text.includes("SELECT EXISTS")) {
    return {
      command: "SELECT",
      oid: 0,
      fields: [],
      rows: [{ exists }],
      rowCount: 1,
    };
  }
  return { command: "", oid: 0, fields: [], rows: [], rowCount: 1 };
}

function fakePool(clients: Array<PoolClient | Error>): Pool & {
  ended: { value: boolean };
  connectAttempts: { value: number };
} {
  const queue = [...clients];
  const ended = { value: false };
  const connectAttempts = { value: 0 };
  return {
    ended,
    connectAttempts,
    connect: async () => {
      connectAttempts.value += 1;
      const client = queue.shift();
      if (!client) throw new Error("unexpected connection");
      if (client instanceof Error) throw client;
      return client;
    },
    end: async () => { ended.value = true; },
  } as unknown as Pool & {
    ended: { value: boolean };
    connectAttempts: { value: number };
  };
}

function liveConfig(): SupabaseBootstrapConfig {
  return config({
    execute: true,
  });
}

async function confirmSecretSink(): Promise<{ outcome: "confirmed" }> {
  return { outcome: "confirmed" };
}

test("one-shot bootstrap migrates in process, verifies runtime, sinks the secret, and closes pools", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const adminPool = fakePool([admin]);
  const runtimePool = fakePool([runtimeIdentity, runtimeSmoke]);
  const poolConfigs: PoolConfig[] = [];
  let migrated = false;
  let initialized = false;
  let secret: RuntimeSecretPayload | undefined;

  await executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
    createPool: (poolConfig) => {
      poolConfigs.push(poolConfig);
      return poolConfigs.length === 1 ? adminPool : runtimePool;
    },
    randomBytes: () => Buffer.alloc(48, 9),
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    migrate: async (_client, options) => {
      migrated = options?.runtimeRole === AMBIENT_RUNTIME_ROLE;
    },
    initializeRuntime: async () => { initialized = true; },
    secretSink: async (payload) => {
      secret = payload;
      return { outcome: "confirmed" };
    },
  });

  assert.equal(migrated, true);
  assert.equal(initialized, true);
  assert.equal(new URL(secret?.postgresUrl ?? "").username, `${AMBIENT_RUNTIME_ROLE}.${PROJECT_REF}`);
  assert.equal(secret?.postgresUrl.includes(ADMIN_SECRET), false);
  assert.equal(poolConfigs[0]?.password, ADMIN_SECRET);
  assert.equal(poolConfigs[0]?.port, 5_432);
  assert.equal(poolConfigs[1]?.port, 6_543);
  assert.equal(poolConfigs[1]?.statement_timeout, 15_000);
  assert.equal(adminPool.ended.value, true);
  assert.equal(runtimePool.ended.value, true);
  assert.equal(admin.released.value, true);
  assert.equal(runtimeIdentity.released.value, true);
  assert.equal(runtimeSmoke.released.value, true);
  assert.equal(runtimeSmoke.calls.at(-1), "ROLLBACK");
});

test("an unconfirmed library sink result is ambiguous and disables runtime login", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const pools = [fakePool([admin]), fakePool([runtimeIdentity, runtimeSmoke])];
  let poolIndex = 0;
  const unconfirmedSink = (async () => undefined) as unknown as NonNullable<
    SupabaseBootstrapDependencies["secretSink"]
  >;

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => pools[poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 21),
      randomUUID: () => "00000000-0000-4000-8000-000000000021",
      migrate: async () => undefined,
      initializeRuntime: async () => undefined,
      secretSink: unconfirmedSink,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("ambiguous")
      && error.message.includes("NOLOGIN"),
  );
  assert.equal(admin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(pools.every((pool) => pool.ended.value), true);
});

test("pre-commit failures drop only the newly created role and close the admin pool", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const adminPool = fakePool([admin]);

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => adminPool,
      randomBytes: () => Buffer.alloc(48, 1),
      migrate: async () => { throw new Error(`do not leak ${ADMIN_SECRET}`); },
      secretSink: confirmSecretSink,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("inspect ambient_runtime")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(admin.calls.some((sql) => sql === 'DROP ROLE IF EXISTS "ambient_runtime"'), true);
  assert.equal(admin.calls.some((sql) => sql.startsWith("DROP OWNED")), false);
  assert.equal(adminPool.ended.value, true);
});

test("lost CREATE ROLE acknowledgement uses NOLOGIN containment without DROP", async () => {
  let failedConnection = false;
  const failedAdmin = fakeClient((text) => {
    if (failedConnection) throw new Error("failed client is unusable");
    if (text.startsWith('CREATE ROLE "ambient_runtime"')) {
      failedConnection = true;
      throw Object.assign(new Error(`create acknowledgement lost ${ADMIN_SECRET}`), {
        code: "ECONNRESET",
      });
    }
    return adminQuery(text, false);
  });
  const containmentAdmin = fakeClient((text) => adminQuery(text, false));
  const adminPool = fakePool([failedAdmin, containmentAdmin]);

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => adminPool,
      randomBytes: () => Buffer.alloc(48, 15),
      secretSink: confirmSecretSink,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("completion is uncertain")
      && error.message.includes("LOGIN was disabled")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(failedAdmin.calls.some((sql) => sql === 'DROP ROLE IF EXISTS "ambient_runtime"'), false);
  assert.equal(failedAdmin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), false);
  assert.equal(containmentAdmin.calls.some((sql) => sql === "SELECT current_user, session_user"), true);
  assert.equal(containmentAdmin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(adminPool.connectAttempts.value, 2);
});

test("definite duplicate CREATE failure never mutates a role the bootstrap did not create", async () => {
  const admin = fakeClient((text) => {
    if (text.startsWith('CREATE ROLE "ambient_runtime"')) {
      throw Object.assign(new Error(`duplicate role ${ADMIN_SECRET}`), { code: "42710" });
    }
    return adminQuery(text, false);
  });
  const adminPool = fakePool([admin]);
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => adminPool,
      randomBytes: () => Buffer.alloc(48, 16),
      secretSink: confirmSecretSink,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("migration failed")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(admin.calls.some((sql) => sql.includes("DROP ROLE")), false);
  assert.equal(admin.calls.some((sql) => sql.includes("ALTER ROLE")), false);
});

test("lost migration commit acknowledgement uses a fresh verified client for NOLOGIN and never DROP", async () => {
  const failedAdmin = fakeClient((text) => adminQuery(text, false));
  const containmentAdmin = fakeClient((text) => adminQuery(text, false));
  const adminPool = fakePool([failedAdmin, containmentAdmin]);

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => adminPool,
      randomBytes: () => Buffer.alloc(48, 13),
      migrate: async () => {
        // Models COMMIT succeeding remotely while its acknowledgement is lost.
        throw new Error("schema migration failed", {
          cause: Object.assign(new Error(`commit acknowledgement lost ${ADMIN_SECRET}`), {
            code: "ECONNRESET",
          }),
        });
      },
      secretSink: confirmSecretSink,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("completion is uncertain")
      && error.message.includes("LOGIN was disabled")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(failedAdmin.calls.some((sql) => sql.includes("DROP ROLE")), false);
  assert.equal(failedAdmin.calls.some((sql) => sql.includes("ALTER ROLE")), false);
  assert.equal(containmentAdmin.calls.some((sql) => sql === "SELECT current_user, session_user"), true);
  assert.equal(containmentAdmin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(adminPool.connectAttempts.value, 2);
  assert.equal(adminPool.ended.value, true);
});

test("no-code and PostgreSQL shutdown errors enter fresh-client ambiguity containment", async () => {
  for (const creationError of [
    new Error("Connection terminated unexpectedly"),
    Object.assign(new Error("administrator shutdown"), { code: "57P01" }),
  ]) {
    const failedAdmin = fakeClient((text) => {
      if (text.startsWith('CREATE ROLE "ambient_runtime"')) throw creationError;
      return adminQuery(text, false);
    });
    const containmentAdmin = fakeClient((text) => adminQuery(text, false));
    const adminPool = fakePool([failedAdmin, containmentAdmin]);
    await assert.rejects(
      () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
        createPool: () => adminPool,
        randomBytes: () => Buffer.alloc(48, 17),
      secretSink: confirmSecretSink,
      }),
      /completion is uncertain/,
    );
    assert.equal(failedAdmin.calls.some((sql) => sql.includes("DROP ROLE")), false);
    assert.equal(containmentAdmin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  }
});

test("lost migration commit acknowledgement reports unconfirmed containment when fresh-client containment fails", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const containmentAdmin = fakeClient((text) => {
    if (text === 'ALTER ROLE "ambient_runtime" NOLOGIN') {
      throw new Error(`cleanup connection lost ${ADMIN_SECRET}`);
    }
    return adminQuery(text, false);
  });
  const adminPool = fakePool([admin, containmentAdmin]);

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => adminPool,
      randomBytes: () => Buffer.alloc(48, 14),
      migrate: async () => {
        throw new Error("schema migration failed", {
          cause: Object.assign(new Error("commit acknowledgement lost"), {
            code: "ECONNRESET",
          }),
        });
      },
      secretSink: confirmSecretSink,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("completion is uncertain")
      && error.message.includes("containment could not be confirmed")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(admin.calls.some((sql) => sql.includes("DROP ROLE")), false);
  assert.equal(containmentAdmin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(adminPool.ended.value, true);
});

test("lost secret-sink response preserves the committed role and disables login", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const pools = [fakePool([admin]), fakePool([runtimeIdentity, runtimeSmoke])];
  let poolIndex = 0;

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => pools[poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 2),
      randomUUID: () => "00000000-0000-4000-8000-000000000002",
      migrate: async () => undefined,
      initializeRuntime: async () => undefined,
      secretSink: async () => { throw new Error(`lost response ${ADMIN_SECRET}`); },
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("ambiguous")
      && error.message.includes("NOLOGIN")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(admin.calls.some((sql) => sql.includes("DROP ROLE")), false);
  assert.equal(admin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(pools.every((pool) => pool.ended.value), true);
});

test("post-commit recovery distinguishes a definite sink failure and reports containment uncertainty", async () => {
  const admin = fakeClient((text) => {
    if (text === 'ALTER ROLE "ambient_runtime" NOLOGIN') {
      throw new Error(`connection lost ${ADMIN_SECRET}`);
    }
    return adminQuery(text, false);
  });
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const pools = [fakePool([admin]), fakePool([runtimeIdentity, runtimeSmoke])];
  let poolIndex = 0;

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => pools[poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 4),
      randomUUID: () => "00000000-0000-4000-8000-000000000004",
      migrate: async () => undefined,
      initializeRuntime: async () => undefined,
      secretSink: async () => {
        throw Object.assign(new Error(`rejected ${ADMIN_SECRET}`), {
          outcome: "definite-failure",
        });
      },
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("definitely failed")
      && error.message.includes("containment could not be confirmed")
      && !error.message.includes(ADMIN_SECRET),
  );
  assert.equal(admin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(admin.calls.some((sql) => sql.includes("DROP ROLE")), false);
  assert.equal(pools.every((pool) => pool.ended.value), true);
});

test("post-commit containment retries NOLOGIN through a fresh verified admin client", async () => {
  const staleAdmin = fakeClient((text) => {
    if (text === 'ALTER ROLE "ambient_runtime" NOLOGIN') {
      throw new Error("stale privileged session");
    }
    return adminQuery(text, false);
  });
  const freshAdmin = fakeClient((text) => adminQuery(text, false));
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const adminPool = fakePool([staleAdmin, freshAdmin]);
  const runtimePool = fakePool([runtimeIdentity, runtimeSmoke]);
  let poolIndex = 0;
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => [adminPool, runtimePool][poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 19),
      randomUUID: () => "00000000-0000-4000-8000-000000000019",
      migrate: async () => undefined,
      initializeRuntime: async () => undefined,
      secretSink: async () => { throw Object.assign(new Error("lost"), { outcome: "ambiguous" }); },
    }),
    /NOLOGIN/,
  );
  assert.equal(freshAdmin.calls.some((sql) => sql === "SELECT current_user, session_user"), true);
  assert.equal(freshAdmin.calls.some((sql) => sql === 'ALTER ROLE "ambient_runtime" NOLOGIN'), true);
  assert.equal(adminPool.connectAttempts.value, 2);
});

test("a pre-existing runtime role is rejected without rotation or cleanup", async () => {
  const admin = fakeClient((text) => adminQuery(text, true));
  const adminPool = fakePool([admin]);
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => adminPool,
      randomBytes: () => Buffer.alloc(48, 3),
      secretSink: confirmSecretSink,
    }),
    /already exists/,
  );
  assert.equal(admin.calls.some((sql) => sql.startsWith("CREATE ROLE")), false);
  assert.equal(admin.calls.some((sql) => sql.includes("DROP ROLE")), false);
});

test("runtime login retries only transient connect/auth propagation failures", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const transient = Object.assign(new Error("password authentication failed"), { code: "28P01" });
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient();
  const pools = [
    fakePool([admin]),
    fakePool([transient, transient, runtimeIdentity, runtimeSmoke]),
  ];
  let poolIndex = 0;
  const delays: number[] = [];
  await executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
    createPool: () => pools[poolIndex++]!,
    randomBytes: () => Buffer.alloc(48, 5),
    randomUUID: () => "00000000-0000-4000-8000-000000000005",
    migrate: async () => undefined,
    initializeRuntime: async () => undefined,
    delay: async (milliseconds) => { delays.push(milliseconds); },
      secretSink: confirmSecretSink,
  });
  assert.deepEqual(delays, [30_000, 30_000]);

  const nonTransientAdmin = fakeClient((text) => adminQuery(text, false));
  const nonTransientPools = [
    fakePool([nonTransientAdmin]),
    fakePool([Object.assign(new Error("certificate mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })]),
  ];
  let nonTransientIndex = 0;
  let delayCalls = 0;
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => nonTransientPools[nonTransientIndex++]!,
      randomBytes: () => Buffer.alloc(48, 6),
      migrate: async () => undefined,
      initializeRuntime: async () => undefined,
      delay: async () => { delayCalls += 1; },
      secretSink: confirmSecretSink,
    }),
    /LOGIN disabled/,
  );
  assert.equal(delayCalls, 0);
});

test("retry exhaustion makes three total attempts, waits twice, closes the pool, and preserves the committed role", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const transient = Object.assign(new Error("password authentication failed"), { code: "28P01" });
  const adminPool = fakePool([admin]);
  const runtimePool = fakePool([transient, transient, transient]);
  let poolIndex = 0;
  const delays: number[] = [];

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => [adminPool, runtimePool][poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 10),
      migrate: async () => undefined,
      delay: async (milliseconds) => { delays.push(milliseconds); },
      secretSink: confirmSecretSink,
    }),
    /LOGIN disabled/,
  );

  assert.equal(runtimePool.connectAttempts.value, 3);
  assert.deepEqual(delays, [30_000, 30_000]);
  assert.equal(runtimePool.ended.value, true);
  assert.equal(admin.calls.some((sql) => sql.includes("DROP ROLE")), false);
});

test("runtime identity and schema initialization failures are never retried", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const wrongIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: "postgres", session_user: "postgres" }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const pools = [fakePool([admin]), fakePool([wrongIdentity])];
  let poolIndex = 0;
  let delayCalls = 0;
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => pools[poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 7),
      migrate: async () => undefined,
      delay: async () => { delayCalls += 1; },
      secretSink: confirmSecretSink,
    }),
    /LOGIN disabled/,
  );
  assert.equal(delayCalls, 0);
  assert.equal(wrongIdentity.calls.filter((sql) => sql === "SELECT current_user, session_user").length, 1);

  const schemaAdmin = fakeClient((text) => adminQuery(text, false));
  const schemaIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const schemaPools = [fakePool([schemaAdmin]), fakePool([schemaIdentity])];
  let schemaPoolIndex = 0;
  let schemaDelayCalls = 0;
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => schemaPools[schemaPoolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 11),
      migrate: async () => undefined,
      initializeRuntime: async () => { throw new Error("schema initialization failed"); },
      delay: async () => { schemaDelayCalls += 1; },
      secretSink: confirmSecretSink,
    }),
    /LOGIN disabled/,
  );
  assert.equal(schemaDelayCalls, 0);
  assert.equal(schemaPools[1]?.connectAttempts.value, 1);
  assert.equal(schemaPools[1]?.ended.value, true);
});

test("rollback-only DML failures are never retried", async () => {
  const admin = fakeClient((text) => adminQuery(text, false));
  const runtimeIdentity = fakeClient((text) => text === "SELECT current_user, session_user"
    ? { rows: [{ current_user: AMBIENT_RUNTIME_ROLE, session_user: AMBIENT_RUNTIME_ROLE }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const runtimeSmoke = fakeClient((text) => {
    if (text.includes('INSERT INTO "ambient_private"."ambient_bridge_devices"')) {
      throw new Error("rollback DML failed");
    }
    return { rows: [], rowCount: 1 };
  });
  const pools = [fakePool([admin]), fakePool([runtimeIdentity, runtimeSmoke])];
  let poolIndex = 0;
  let delayCalls = 0;

  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      createPool: () => pools[poolIndex++]!,
      randomBytes: () => Buffer.alloc(48, 12),
      migrate: async () => undefined,
      initializeRuntime: async () => undefined,
      delay: async () => { delayCalls += 1; },
      secretSink: confirmSecretSink,
    }),
    /LOGIN disabled/,
  );
  assert.equal(delayCalls, 0);
  assert.equal(pools[1]?.connectAttempts.value, 2);
  assert.equal(pools[1]?.ended.value, true);
  assert.equal(runtimeSmoke.calls.filter((sql) => sql === "BEGIN").length, 1);
});

test("live library execution fails before generating credentials without a secret sink", async () => {
  let randomCalls = 0;
  await assert.rejects(
    () => executeSupabaseBootstrap(liveConfig(), ADMIN_SECRET, {
      randomBytes: () => { randomCalls += 1; return Buffer.alloc(48, 8); },
    }),
    /injected in-process secret sink/,
  );
  assert.equal(randomCalls, 0);
});
