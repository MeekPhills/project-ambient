import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import { MemoryBridgeStore } from "../src/bridge/store.js";
import type { BridgeCommand, BridgeRateLimitScope } from "../src/bridge/types.js";
import { createHttpApp } from "../src/http-app.js";

test("device result API requires the current lease and safely acknowledges retries", async (t) => {
  const store = new MemoryBridgeStore();
  const { device, token } = await store.createDevice("Test Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 180);
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));

  const { port } = listener.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/bridge/v1`;
  const deviceHeaders = {
    authorization: `Bearer ${token}`,
    "x-ambient-device-id": device.deviceId,
    "x-ambient-protocol-version": "2",
    "x-ambient-capabilities": "lease_id",
  };
  const leasedResponse = await fetch(`${baseUrl}/agent/commands/next`, { headers: deviceHeaders });
  assert.equal(leasedResponse.status, 200);
  const leased = (await leasedResponse.json() as { command: BridgeCommand }).command;
  assert.equal(leased.id, command.id);
  assert.ok(leased.leaseId);

  const postResult = (leaseId: string | undefined) => fetch(
    `${baseUrl}/agent/commands/${encodeURIComponent(command.id)}/result`,
    {
      method: "POST",
      headers: { ...deviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        status: "succeeded",
        ...(leaseId === undefined ? {} : { lease_id: leaseId }),
        result: { online: true },
      }),
    },
  );

  assert.equal((await postResult(undefined)).status, 400);
  assert.equal((await postResult("lease_stale-worker")).status, 409);
  assert.equal((await postResult(leased.leaseId)).status, 200);
  assert.equal((await postResult(leased.leaseId)).status, 200);
  assert.equal((await store.getCommand(command.id))?.status, "succeeded");
});

test("incompatible agents receive 426 without touching delivery state", async (t) => {
  const store = new MemoryBridgeStore();
  const { device, token } = await store.createDevice("Test Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 180);
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = listener.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/bridge/v1/agent/commands/next`;
  const authentication = {
    authorization: `Bearer ${token}`,
    "x-ambient-device-id": device.deviceId,
  };

  const missing = await fetch(url, { headers: authentication });
  assert.equal(missing.status, 426);
  assert.equal(missing.headers.get("x-ambient-protocol-version"), "2");
  const v1 = await fetch(url, {
    headers: {
      ...authentication,
      "x-ambient-protocol-version": "1",
      "x-ambient-capabilities": "lease_id",
    },
  });
  assert.equal(v1.status, 426);
  const unchanged = await store.getCommand(command.id);
  assert.equal(unchanged?.status, "pending");
  assert.equal(unchanged?.attemptCount, 0);
  assert.equal((await store.getDevice(device.deviceId))?.lastSeenAt, null);
});

test("bridge ingress throttles abuse independently of spoofable device headers", async (t) => {
  const store = new MemoryBridgeStore();
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    bridgeRateLimits: { ingressWindowMs: 60_000, ingressLimit: 2 },
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = listener.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/bridge/v1/agent/commands/next`;
  const request = (deviceId: string, forwardedFor: string) => fetch(url, {
    headers: {
      authorization: "Bearer invalid-device-token",
      "x-ambient-device-id": deviceId,
      "x-forwarded-for": forwardedFor,
      "x-ambient-protocol-version": "2",
      "x-ambient-capabilities": "lease_id",
    },
  });

  assert.equal((await request("spoofed-device-a", "198.51.100.10")).status, 401);
  assert.equal((await request("spoofed-device-b", "198.51.100.11")).status, 401);
  const limited = await request("spoofed-device-c", "198.51.100.12");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.ok(limited.headers.get("ratelimit"));
  assert.ok(limited.headers.get("retry-after"));
  assert.deepEqual(await limited.json(), { error: "rate_limit_exceeded" });
});

test("a configured trusted proxy keys ingress by the validated forwarded client", async (t) => {
  const store = new MemoryBridgeStore();
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    bridgeRateLimits: { ingressWindowMs: 60_000, ingressLimit: 1 },
    trustedProxies: ["127.0.0.1"],
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = listener.address() as AddressInfo;
  const request = (clientIp: string) => fetch(
    `http://127.0.0.1:${port}/bridge/v1/agent/commands/next`,
    { headers: { "x-forwarded-for": clientIp } },
  );

  assert.equal((await request("198.51.100.20")).status, 401);
  assert.equal((await request("198.51.100.21")).status, 401);
  assert.equal((await request("198.51.100.20")).status, 429);
});

test("distributed limiter failure returns generic 503 before authentication or lease mutation", async (t) => {
  class FailingRateLimitStore extends MemoryBridgeStore {
    readonly distributedRateLimit = true;
    authenticationCalls = 0;

    async incrementRateLimit(
      _scope: BridgeRateLimitScope,
      _keyHash: string,
      _windowMs: number,
    ): Promise<{ totalHits: number; resetTime: Date }> {
      throw new Error("database credentials and topology must not escape");
    }

    async decrementRateLimit(): Promise<void> {}
    async resetRateLimit(): Promise<void> {}

    override async authenticateDevice(deviceId: string, token: string) {
      this.authenticationCalls += 1;
      return super.authenticateDevice(deviceId, token);
    }
  }

  const store = new FailingRateLimitStore();
  const { device, token } = await store.createDevice("Unavailable Limiter Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 180);
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    bridgeRateLimits: { distributed: true },
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = listener.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/bridge/v1/agent/commands/next`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ambient-device-id": device.deviceId,
      "x-ambient-protocol-version": "2",
      "x-ambient-capabilities": "lease_id",
    },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "rate_limit_unavailable" });
  assert.equal(store.authenticationCalls, 0);
  assert.equal((await store.getCommand(command.id))?.attemptCount, 0);
  assert.equal((await store.getDevice(device.deviceId))?.lastSeenAt, null);
});

test("admin commands enforce the 180-second delivery window and an authenticated quota", async (t) => {
  const store = new MemoryBridgeStore();
  const { device } = await store.createDevice("Admin Quota Mac");
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    bridgeRateLimits: { ingressLimit: 20, adminLimit: 2 },
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = listener.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/bridge/v1/admin/commands`;
  const headers = {
    authorization: "Bearer bridge-admin-test-token",
    "content-type": "application/json",
  };
  const body = { device_id: device.deviceId, operation: { type: "get_status" } };
  const accepted = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(accepted.status, 202);
  const acceptedCommand = (await accepted.json() as { command: BridgeCommand }).command;
  assert.ok(Date.parse(acceptedCommand.expiresAt) - Date.parse(acceptedCommand.createdAt) >= 179_000);
  assert.equal((await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, ttl_seconds: 60 }),
  })).status, 400);
  const limited = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(limited.status, 429);
});

test("authenticated device throttling permits normal polls then returns JSON 429", async (t) => {
  const store = new MemoryBridgeStore();
  const { device, token } = await store.createDevice("Rate Limited Mac");
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    bridgeStore: store,
    bridgeAdminToken: "bridge-admin-test-token",
    bridgeRateLimits: {
      ingressWindowMs: 60_000,
      ingressLimit: 20,
      deviceWindowMs: 60_000,
      deviceLimit: 2,
    },
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = listener.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/bridge/v1/agent/commands/next`;
  const headers = {
    authorization: `Bearer ${token}`,
    "x-ambient-device-id": device.deviceId,
    "x-ambient-protocol-version": "2",
    "x-ambient-capabilities": "lease_id",
  };

  assert.equal((await fetch(url, { headers })).status, 204);
  assert.equal((await fetch(url, { headers })).status, 204);
  const limited = await fetch(url, { headers });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "rate_limit_exceeded" });
});
