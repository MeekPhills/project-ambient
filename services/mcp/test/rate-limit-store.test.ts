import assert from "node:assert/strict";
import test from "node:test";
import type { Options } from "express-rate-limit";
import {
  BridgeRateLimitStore,
  BridgeRateLimitUnavailableError,
} from "../src/bridge/rate-limit-store.js";
import type { BridgeRateLimitScope, BridgeStore } from "../src/bridge/types.js";

test("distributed limiter sends only a scoped one-way client key to persistence", async () => {
  const calls: Array<{ scope: BridgeRateLimitScope; keyHash: string; windowMs?: number }> = [];
  const bridgeStore = {
    incrementRateLimit: async (scope: BridgeRateLimitScope, keyHash: string, windowMs: number) => {
      calls.push({ scope, keyHash, windowMs });
      return { totalHits: 1, resetTime: new Date("2026-08-12T16:01:00.000Z") };
    },
    decrementRateLimit: async (scope: BridgeRateLimitScope, keyHash: string) => {
      calls.push({ scope, keyHash });
    },
    resetRateLimit: async (scope: BridgeRateLimitScope, keyHash: string) => {
      calls.push({ scope, keyHash });
    },
  } as unknown as BridgeStore;
  const store = new BridgeRateLimitStore(bridgeStore, "device-result");
  store.init({ windowMs: 60_000 } as Options);

  await store.increment("device_unhashed-identity");
  await store.decrement("device_unhashed-identity");
  await store.resetKey("device_unhashed-identity");
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.scope, "device-result");
    assert.notEqual(call.keyHash, "device_unhashed-identity");
    assert.match(call.keyHash, /^[A-Za-z0-9_-]{43}$/);
  }
  assert.equal(new Set(calls.map(({ keyHash }) => keyHash)).size, 1);
  assert.equal(calls[0]?.windowMs, 60_000);
});

test("distributed persistence errors become the dedicated fail-closed error", async () => {
  const failure = new Error("private database detail");
  const bridgeStore = {
    incrementRateLimit: async () => { throw failure; },
    decrementRateLimit: async () => { throw failure; },
    resetRateLimit: async () => { throw failure; },
  } as unknown as BridgeStore;
  const store = new BridgeRateLimitStore(bridgeStore, "ingress");
  store.init({ windowMs: 60_000 } as Options);

  for (const operation of [
    () => store.increment("client"),
    () => store.decrement("client"),
    () => store.resetKey("client"),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof BridgeRateLimitUnavailableError);
      assert.equal(error.cause, failure);
      return true;
    });
  }
});
