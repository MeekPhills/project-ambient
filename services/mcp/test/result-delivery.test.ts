import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverPendingBridgeResult,
  retryAfterMilliseconds,
  type PendingBridgeResult,
} from "../src/bridge/result-delivery.js";

const origin = Date.parse("2026-08-12T16:00:00.000Z");

function pending(deadlineMs = 120_000): PendingBridgeResult {
  return {
    commandId: "bridge_command-1",
    leaseId: "lease_fenced-1",
    leaseExpiresAt: new Date(origin + deadlineMs).toISOString(),
    expiresAt: new Date(origin + 180_000).toISOString(),
    body: { status: "succeeded", result: { applied: true } },
  };
}

function protocolResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: {
      "x-ambient-protocol-version": "2",
      "x-ambient-capabilities": "lease_id",
      ...headers,
    },
  });
}

test("a throttled result is resent exactly and acknowledged without re-execution or another poll", async () => {
  let now = origin;
  let executionCount = 0;
  let pollCount = 0;
  let protocolChecks = 0;
  const requests: Array<{ url: string; body: string | undefined }> = [];
  const responses = [
    protocolResponse(429, { "retry-after": "1" }),
    protocolResponse(200),
  ];
  executionCount += 1;
  pollCount += 1;

  await deliverPendingBridgeResult(pending(), {
    url: "https://bridge.example",
    headers: { authorization: "Bearer redacted-in-test" },
    fetch: (async (url, init) => {
      requests.push({ url: String(url), body: init?.body?.toString() });
      const response = responses.shift();
      assert.ok(response);
      return response;
    }) as typeof fetch,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    baseRetryMs: 250,
    assertProtocol: () => { protocolChecks += 1; },
  });

  assert.equal(executionCount, 1);
  assert.equal(pollCount, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, requests[1]?.url);
  assert.equal(requests[0]?.body, requests[1]?.body);
  assert.match(requests[0]?.body ?? "", /"lease_id":"lease_fenced-1"/);
  assert.equal(protocolChecks, 1);
  assert.equal(now, origin + 1_000);
});

for (const status of [400, 409]) {
  test(`HTTP ${status} rejects a pending result without retry`, async () => {
    let attempts = 0;
    await assert.rejects(
      deliverPendingBridgeResult(pending(), {
        url: "https://bridge.example",
        headers: {},
        fetch: (async () => {
          attempts += 1;
          return protocolResponse(status);
        }) as typeof fetch,
        now: () => origin,
        sleep: async () => assert.fail("non-retryable response must not sleep"),
        baseRetryMs: 250,
        assertProtocol: () => assert.fail("error response must not pass protocol validation"),
      }),
      status === 409 ? /lease is no longer usable/ : /rejected result with HTTP 400/,
    );
    assert.equal(attempts, 1);
  });
}

test("Retry-After beyond the original lease deadline fails without dropping into another request", async () => {
  let attempts = 0;
  await assert.rejects(
    deliverPendingBridgeResult(pending(30_000), {
      url: "https://bridge.example",
      headers: {},
      fetch: (async () => {
        attempts += 1;
        return protocolResponse(429, { "retry-after": "60" });
      }) as typeof fetch,
      now: () => origin,
      sleep: async () => assert.fail("an unusable lease must not sleep"),
      baseRetryMs: 250,
      assertProtocol: () => undefined,
    }),
    /could not be acknowledged before its lease expired/,
  );
  assert.equal(attempts, 1);
});

test("result delivery never starts inside the deadline reserve and sizes the HTTP timeout to remaining lease", async () => {
  let fetches = 0;
  await assert.rejects(
    deliverPendingBridgeResult(pending(1_000), {
      url: "https://bridge.example",
      headers: {},
      fetch: (async () => {
        fetches += 1;
        return protocolResponse(200);
      }) as typeof fetch,
      now: () => origin,
      sleep: async () => undefined,
      baseRetryMs: 250,
      assertProtocol: () => undefined,
    }),
    /lease expired before acknowledgement/,
  );
  assert.equal(fetches, 0);

  const requestedTimeouts: number[] = [];
  await deliverPendingBridgeResult(pending(3_000), {
    url: "https://bridge.example",
    headers: {},
    fetch: (async () => protocolResponse(200)) as typeof fetch,
    now: () => origin,
    sleep: async () => undefined,
    baseRetryMs: 250,
    assertProtocol: () => undefined,
    timeoutSignal: (milliseconds) => {
      requestedTimeouts.push(milliseconds);
      return new AbortController().signal;
    },
  });
  assert.deepEqual(requestedTimeouts, [2_000]);
});

test("network and server failures retry the same payload within the lease", async () => {
  let now = origin;
  let attempts = 0;
  const payloads: string[] = [];
  await deliverPendingBridgeResult(pending(), {
    url: "https://bridge.example",
    headers: {},
    fetch: (async (_url, init) => {
      attempts += 1;
      payloads.push(init?.body?.toString() ?? "");
      if (attempts === 1) throw new TypeError("temporary network failure");
      if (attempts === 2) return protocolResponse(503);
      return protocolResponse(200);
    }) as typeof fetch,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    baseRetryMs: 250,
    assertProtocol: () => undefined,
  });
  assert.equal(attempts, 3);
  assert.equal(new Set(payloads).size, 1);
  assert.equal(now, origin + 750);
});

test("Retry-After supports delta seconds and HTTP dates with a bounded delay", () => {
  assert.equal(retryAfterMilliseconds(protocolResponse(429, { "retry-after": "2" }), origin), 2_000);
  assert.equal(
    retryAfterMilliseconds(
      protocolResponse(429, { "retry-after": new Date(origin + 5_000).toUTCString() }),
      origin,
    ),
    5_000,
  );
  assert.equal(retryAfterMilliseconds(protocolResponse(429, { "retry-after": "600" }), origin), 60_000);
  assert.equal(retryAfterMilliseconds(protocolResponse(503, { "retry-after": "2" }), origin), 0);
});
