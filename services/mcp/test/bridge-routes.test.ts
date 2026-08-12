import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import { MemoryBridgeStore } from "../src/bridge/store.js";
import type { BridgeCommand } from "../src/bridge/types.js";
import { createHttpApp } from "../src/http-app.js";

test("device result API requires the current lease and safely acknowledges retries", async (t) => {
  const store = new MemoryBridgeStore();
  const { device, token } = await store.createDevice("Test Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 60);
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
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 60);
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
