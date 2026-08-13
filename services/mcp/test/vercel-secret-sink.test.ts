import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanonicalRuntimePostgresUrl,
  createVercelSensitiveSecretSink,
  VERCEL_API_ORIGIN,
  VERCEL_PROJECT_ID,
  VERCEL_RUNTIME_ENV_KEY,
  VERCEL_TEAM_ID,
  VercelSecretSinkError,
  type VercelSensitiveSecretSink,
} from "../src/bridge/vercel-secret-sink.js";

const TOKEN_SENTINEL = "vercel_token_sentinel_1234567890";
const RESPONSE_SENTINEL = "response-body-sentinel-never-expose";
const POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com";
const PASSWORD = "A".repeat(64);
const POSTGRES_URL = `postgresql://ambient_runtime.mbcxfyekqyexpqshamwq:${PASSWORD}@${POOLER_HOST}:6543/postgres?sslmode=verify-full`;

const PROJECT_URL = `${VERCEL_API_ORIGIN}/v9/projects/${VERCEL_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}`;
const ENVIRONMENT_URL = `${VERCEL_API_ORIGIN}/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`;

const exactMetadata = {
  id: "env_project_ambient_postgres_url",
  key: VERCEL_RUNTIME_ENV_KEY,
  type: "sensitive",
  target: ["production"],
  gitBranch: null,
  customEnvironmentIds: [],
};
const createResponse = { created: exactMetadata, failed: [] };

interface FetchCall {
  url: string;
  init: RequestInit;
  body?: Buffer;
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

function responseSequence(
  responses: Array<Response | Error | ((call: FetchCall) => Response | Promise<Response>)>,
): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImplementation = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const call: FetchCall = {
      url: String(input),
      init: {
        ...init,
        headers: new Headers(init.headers),
      },
      body: Buffer.isBuffer(init.body) ? Buffer.from(init.body) : undefined,
    };
    calls.push(call);
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response(call) : response;
  }) as typeof globalThis.fetch;
  return { fetch: fetchImplementation, calls };
}

function preflightResponses(): Response[] {
  return [
    jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID }),
    jsonResponse({ envs: [] }),
  ];
}

async function expectOutcome(
  operation: () => Promise<unknown>,
  outcome: "definite-failure" | "ambiguous",
): Promise<VercelSecretSinkError> {
  let captured: unknown;
  try {
    await operation();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof VercelSecretSinkError);
  assert.equal(captured.outcome, outcome);
  assert.equal(captured.message.includes(TOKEN_SENTINEL), false);
  assert.equal(captured.message.includes(POSTGRES_URL), false);
  assert.equal(captured.message.includes(RESPONSE_SENTINEL), false);
  return captured;
}

async function preflight(sink: VercelSensitiveSecretSink): Promise<void> {
  await sink.preflight();
}

test("uses only the fixed Vercel origin, paths, query, method, body, and sensitive production metadata", async () => {
  const transport = responseSequence([
    ...preflightResponses(),
    jsonResponse(createResponse, 201),
    jsonResponse({ envs: [exactMetadata] }),
  ]);
  const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: transport.fetch,
    delay: async () => undefined,
  });
  await preflight(sink);
  assert.deepEqual(await sink.write({ postgresUrl: POSTGRES_URL }), { outcome: "confirmed" });

  assert.deepEqual(transport.calls.map((call) => call.url), [
    PROJECT_URL,
    ENVIRONMENT_URL,
    ENVIRONMENT_URL,
    ENVIRONMENT_URL,
  ]);
  assert.deepEqual(transport.calls.map((call) => call.init.method), ["GET", "GET", "POST", "GET"]);
  for (const call of transport.calls) {
    assert.equal(call.init.redirect, "error");
    assert.equal(new Headers(call.init.headers).get("authorization"), `Bearer ${TOKEN_SENTINEL}`);
  }
  assert.deepEqual(JSON.parse(transport.calls[2]!.body!.toString("utf8")), {
    key: "POSTGRES_URL",
    value: POSTGRES_URL,
    type: "sensitive",
    target: ["production"],
  });
  assert.equal(transport.calls.filter((call) => call.body).length, 1);
  sink.dispose();
  await expectOutcome(() => sink.preflight(), "definite-failure");
});

test("rejects every runtime URL topology override before the POST request", async () => {
  const invalidUrls = [
    POSTGRES_URL.replace("postgresql:", "postgres:"),
    POSTGRES_URL.replace(POOLER_HOST, "aws-0-us-east-1.pooler.supabase.com.evil.test"),
    POSTGRES_URL.replace(":6543/", ":5432/"),
    POSTGRES_URL.replace("/postgres?", "/template1?"),
    POSTGRES_URL.replace("ambient_runtime.mbcxfyekqyexpqshamwq", "postgres.mbcxfyekqyexpqshamwq"),
    POSTGRES_URL.replace(PASSWORD, "B".repeat(63)),
    `${POSTGRES_URL}&host=evil.example`,
    `${POSTGRES_URL}&sslmode=disable`,
    `${POSTGRES_URL}&port=5432`,
    `${POSTGRES_URL}#fragment`,
    POSTGRES_URL.replace("?sslmode=verify-full", ""),
  ];
  for (const invalidUrl of invalidUrls) {
    assert.throws(
      () => assertCanonicalRuntimePostgresUrl(invalidUrl, POOLER_HOST),
      VercelSecretSinkError,
    );
    const transport = responseSequence(preflightResponses());
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await sink.preflight();
    await expectOutcome(() => sink.write({ postgresUrl: invalidUrl }), "definite-failure");
    assert.equal(transport.calls.length, 2);
    sink.dispose();
  }
});

test("preflight authenticates the exact project/team and refuses every existing POSTGRES_URL", async () => {
  for (const project of [
    { id: "prj_wrong", accountId: VERCEL_TEAM_ID },
    { id: VERCEL_PROJECT_ID, accountId: "team_wrong" },
    { id: VERCEL_PROJECT_ID },
  ]) {
    const transport = responseSequence([jsonResponse(project)]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await expectOutcome(() => sink.preflight(), "definite-failure");
    assert.equal(transport.calls.length, 1);
  }

  for (const existing of [
    exactMetadata,
    { key: "POSTGRES_URL", type: "encrypted", target: ["preview"] },
    { key: "POSTGRES_URL", type: "sensitive", target: ["production"], gitBranch: "main" },
    { key: "POSTGRES_URL", type: "sensitive", target: [], customEnvironmentIds: ["env_1"] },
  ]) {
    const transport = responseSequence([
      jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID }),
      jsonResponse({ envs: [existing] }),
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await expectOutcome(() => sink.preflight(), "definite-failure");
    assert.equal(transport.calls.length, 2);
  }

  for (const hiddenProductionEnvCount of [1, 7, -1, "0"]) {
    const transport = responseSequence([
      jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID }),
      jsonResponse({ envs: [], hiddenProductionEnvCount }),
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await expectOutcome(() => sink.preflight(), "definite-failure");
  }

  for (const pagination of [
    { count: 100, next: 123, prev: null },
    { count: "0", next: null, prev: null },
    { count: 0, next: "cursor", prev: null },
    { count: 0, next: null, prev: "cursor" },
    { count: 1, next: null, prev: null },
  ]) {
    const transport = responseSequence([
      jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID }),
      jsonResponse({ envs: [], pagination }),
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await expectOutcome(() => sink.preflight(), "definite-failure");
  }
  const terminalTransport = responseSequence([
    jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID }),
    jsonResponse({
      envs: [],
      hiddenProductionEnvCount: 0,
      pagination: { count: 0, next: null, prev: null },
    }),
  ]);
  const terminalSink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: terminalTransport.fetch,
    delay: async () => undefined,
  });
  await terminalSink.preflight();
});

test("accepts official scalar or one-item-array production targets only", async () => {
  for (const target of ["production", ["production"]]) {
    const record = { ...exactMetadata, target };
    const transport = responseSequence([
      ...preflightResponses(),
      jsonResponse({ created: record, failed: [] }, 201),
      jsonResponse({ envs: [record] }),
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await sink.preflight();
    assert.deepEqual(await sink.write({ postgresUrl: POSTGRES_URL }), { outcome: "confirmed" });
  }
});

test("classifies malformed 2xx, redirects, and ordinary 4xx without retrying", async () => {
  for (const scenario of [
    { response: new Response("not-json", { status: 200 }), outcome: "ambiguous" as const },
    { response: new Response(null, { status: 307, headers: { location: "https://evil.invalid" } }), outcome: "definite-failure" as const },
    { response: jsonResponse({ error: RESPONSE_SENTINEL }, 400), outcome: "definite-failure" as const },
    { response: jsonResponse({ error: RESPONSE_SENTINEL }, 401), outcome: "definite-failure" as const },
    { response: jsonResponse({ error: RESPONSE_SENTINEL }, 409), outcome: "definite-failure" as const },
  ]) {
    const transport = responseSequence([...preflightResponses(), scenario.response]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await sink.preflight();
    await expectOutcome(() => sink.write({ postgresUrl: POSTGRES_URL }), scenario.outcome);
    assert.equal(transport.calls.length, 3);
  }
});

test("retries only 408, 429, and 5xx preflight responses with a bounded Retry-After", async () => {
  for (const status of [408, 429, 500, 503]) {
    const delays: number[] = [];
    const transport = responseSequence([
      new Response(null, { status, headers: { "retry-after": "999" } }),
      jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID }),
      jsonResponse({ envs: [] }),
      jsonResponse(createResponse, 201),
      jsonResponse({ envs: [exactMetadata] }),
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    await sink.preflight();
    assert.deepEqual(await sink.write({ postgresUrl: POSTGRES_URL }), { outcome: "confirmed" });
    assert.deepEqual(delays, [30_000]);
    assert.equal(transport.calls.filter((call) => call.init.method === "POST").length, 1);
  }
});

test("a committed response loss is ambiguous and the create-only mutation is never replayed", async () => {
  const reset = Object.assign(new TypeError("socket reset after commit"), { code: "ECONNRESET" });
  const transport = responseSequence([
    ...preflightResponses(),
    reset,
  ]);
  const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: transport.fetch,
    delay: async () => undefined,
  });
  await sink.preflight();
  await expectOutcome(() => sink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
  assert.equal(transport.calls.filter((call) => call.init.method === "POST").length, 1);
});

test("reset, retryable status, and timeout are ambiguous without replay after POST starts", async () => {
  const resetTransport = responseSequence([
    ...preflightResponses(),
    new TypeError(RESPONSE_SENTINEL),
  ]);
  const resetSink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: resetTransport.fetch,
    delay: async () => undefined,
  });
  await resetSink.preflight();
  await expectOutcome(() => resetSink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
  assert.equal(resetTransport.calls.filter((call) => call.init.method === "POST").length, 1);

  const statusTransport = responseSequence([
    ...preflightResponses(),
    new Response(null, { status: 503 }),
  ]);
  const statusSink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: statusTransport.fetch,
    delay: async () => undefined,
  });
  await statusSink.preflight();
  await expectOutcome(() => statusSink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
  assert.equal(statusTransport.calls.filter((call) => call.init.method === "POST").length, 1);

  let timeoutPostCalls = 0;
  const timeoutFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input) === PROJECT_URL) {
      return jsonResponse({ id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID });
    }
    if (String(input) === ENVIRONMENT_URL && init.method === "GET") {
      return jsonResponse({ envs: [] });
    }
    timeoutPostCalls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  }) as typeof globalThis.fetch;
  const timeoutSink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: timeoutFetch,
    delay: async () => undefined,
    requestTimeoutMs: 5,
  });
  await timeoutSink.preflight();
  await expectOutcome(() => timeoutSink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
  assert.equal(timeoutPostCalls, 1);
});

test("create-only POST refuses a variable inserted after preflight and never overwrites it", async () => {
  const transport = responseSequence([
    ...preflightResponses(),
    (call) => {
      assert.equal(call.url, ENVIRONMENT_URL);
      assert.equal(call.url.includes("upsert"), false);
      return jsonResponse({ error: "variable already exists" }, 409);
    },
  ]);
  const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: transport.fetch,
    delay: async () => undefined,
  });
  await sink.preflight();
  await expectOutcome(() => sink.write({ postgresUrl: POSTGRES_URL }), "definite-failure");
  assert.equal(transport.calls.filter((call) => call.init.method === "POST").length, 1);
});

test("post-write confirmation requires one exact non-branch production-sensitive record", async () => {
  for (const confirmation of [
    {},
    { envs: [null] },
    { envs: [] },
    { envs: [exactMetadata, exactMetadata] },
    { envs: [{ ...exactMetadata, type: "encrypted" }] },
    { envs: [{ ...exactMetadata, visibility: "config" }] },
    { envs: [{ ...exactMetadata, target: ["production", "preview"] }] },
    { envs: [{ ...exactMetadata, gitBranch: "main" }] },
    { envs: [{ ...exactMetadata, customEnvironmentIds: ["env_custom"] }] },
    { envs: [{ ...exactMetadata, customEnvironmentId: "env_custom" }] },
    { envs: [{ ...exactMetadata, id: "env_recreated" }] },
  ]) {
    const transport = responseSequence([
      ...preflightResponses(),
      jsonResponse(createResponse, 201),
      jsonResponse(confirmation),
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await sink.preflight();
    await expectOutcome(() => sink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
  }
});

test("requires exact HTTP 201 wrapper for creation and rejects partial official failures", async () => {
  for (const createResult of [
    jsonResponse(createResponse, 200),
    jsonResponse(exactMetadata, 201),
    jsonResponse({ created: { ...exactMetadata, id: "" }, failed: [] }, 201),
    jsonResponse({ created: exactMetadata, failed: [{ code: "bad_request" }] }, 201),
    jsonResponse({ created: [], failed: [] }, 201),
    jsonResponse({ created: [exactMetadata, exactMetadata], failed: [] }, 201),
  ]) {
    const transport = responseSequence([
      ...preflightResponses(),
      createResult,
    ]);
    const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
      fetch: transport.fetch,
      delay: async () => undefined,
    });
    await sink.preflight();
    await expectOutcome(() => sink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
  }
});

test("bounds successful JSON responses and never surfaces body or credential sentinels", async () => {
  const oversized = new Response(JSON.stringify({ value: RESPONSE_SENTINEL.repeat(3_000) }), {
    status: 200,
    headers: { "content-length": "100000" },
  });
  const transport = responseSequence([...preflightResponses(), oversized]);
  const sink = createVercelSensitiveSecretSink(TOKEN_SENTINEL, POOLER_HOST, {
    fetch: transport.fetch,
    delay: async () => undefined,
  });
  await sink.preflight();
  await expectOutcome(() => sink.write({ postgresUrl: POSTGRES_URL }), "ambiguous");
});
