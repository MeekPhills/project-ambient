import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBridgeStore } from "../src/bridge/store.js";
import { RemoteAmbientAdapter } from "../src/bridge/remote-adapter.js";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";

test("bridge enrollment, authentication, leasing, completion, and revocation", async () => {
  const store = new MemoryBridgeStore();
  const { device, token } = await store.createDevice("Test Mac");
  assert.ok(await store.authenticateDevice(device.deviceId, token));
  assert.equal(await store.authenticateDevice(device.deviceId, "wrong-token"), null);

  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 60);
  const leased = await store.leaseNext(device.deviceId, 30);
  assert.equal(leased?.id, command.id);
  const result = { deviceId: device.deviceId, online: true };
  assert.equal((await store.complete(command.id, device.deviceId, result))?.status, "succeeded");
  assert.deepEqual((await store.getCommand(command.id))?.result, result);

  assert.equal(await store.revokeDevice(device.deviceId, new Date().toISOString()), true);
  assert.equal(await store.authenticateDevice(device.deviceId, token), null);
});

test("remote adapter correlates a queued command with its outbound device result", async () => {
  const store = new MemoryBridgeStore();
  const { device } = await store.createDevice("Test Mac");
  const demo = new DemoAmbientAdapter(() => new Date("2026-08-12T15:30:00.000Z"));
  const remote = new RemoteAmbientAdapter({
    store,
    deviceId: device.deviceId,
    resultTimeoutMs: 2_000,
    pollIntervalMs: 5,
  });

  const deviceWorker = (async () => {
    let command = await store.leaseNext(device.deviceId, 30);
    while (!command) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      command = await store.leaseNext(device.deviceId, 30);
    }
    assert.equal(command.operation.type, "get_status");
    await store.complete(command.id, device.deviceId, await demo.getStatus());
  })();

  const status = await remote.getStatus();
  await deviceWorker;
  assert.equal(status.currentChannelId, "beaches");
});
