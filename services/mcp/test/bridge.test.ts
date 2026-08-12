import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBridgeStore } from "../src/bridge/store.js";
import { RemoteAmbientAdapter } from "../src/bridge/remote-adapter.js";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import {
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
} from "../src/bridge/types.js";

test("bridge enrollment, authentication, leasing, completion, and revocation", async () => {
  const store = new MemoryBridgeStore();
  const { device, token } = await store.createDevice("Test Mac");
  assert.ok(await store.authenticateDevice(device.deviceId, token));
  assert.equal(await store.authenticateDevice(device.deviceId, "wrong-token"), null);

  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 60);
  const leased = await store.leaseNext(device.deviceId, 30);
  assert.equal(leased?.id, command.id);
  assert.ok(leased?.leaseId);
  const result = { deviceId: device.deviceId, online: true };
  assert.equal(
    (await store.complete(command.id, device.deviceId, leased.leaseId, result))?.status,
    "succeeded",
  );
  assert.deepEqual((await store.getCommand(command.id))?.result, result);

  assert.equal(await store.revokeDevice(device.deviceId, new Date().toISOString()), true);
  assert.equal(await store.authenticateDevice(device.deviceId, token), null);
});

test("mutation request IDs deduplicate, reject conflicting reuse, and recover expired delivery", async () => {
  let now = Date.parse("2026-08-12T15:30:00.000Z");
  const store = new MemoryBridgeStore(() => new Date(now));
  const { device } = await store.createDevice("Test Mac");
  const operation = { type: "pause", durationMinutes: 15, requestId: "bridge-request-00000001" } as const;

  const first = await store.enqueue(device.deviceId, operation, 5);
  const duplicate = await store.enqueue(device.deviceId, operation, 5);
  assert.equal(duplicate.id, first.id);

  await assert.rejects(
    store.enqueue(
      device.deviceId,
      { type: "resume", requestId: operation.requestId },
      5,
    ),
    BridgeRequestConflictError,
  );

  now += 6_000;
  assert.equal((await store.getCommand(first.id))?.status, "expired");
  const recovered = await store.enqueue(device.deviceId, operation, 30);
  assert.equal(recovered.id, first.id);
  assert.equal(recovered.status, "pending");
  assert.ok(Date.parse(recovered.expiresAt) > now);
});

test("lease fencing rejects stale workers and makes result acknowledgements idempotent", async () => {
  let now = Date.parse("2026-08-12T15:30:00.000Z");
  const store = new MemoryBridgeStore(() => new Date(now));
  const { device } = await store.createDevice("Test Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 120);
  const firstLease = await store.leaseNext(device.deviceId, 30);
  assert.ok(firstLease?.leaseId);

  now += 31_000;
  assert.equal(
    await store.complete(command.id, device.deviceId, firstLease.leaseId, { online: true }),
    null,
  );
  const secondLease = await store.leaseNext(device.deviceId, 30);
  assert.ok(secondLease?.leaseId);
  assert.notEqual(secondLease.leaseId, firstLease.leaseId);
  assert.equal(
    await store.complete(command.id, device.deviceId, firstLease.leaseId, { online: false }),
    null,
  );

  const completed = await store.complete(
    command.id,
    device.deviceId,
    secondLease.leaseId,
    { online: true },
  );
  assert.equal(completed?.status, "succeeded");
  assert.deepEqual(
    await store.complete(command.id, device.deviceId, secondLease.leaseId, { online: true }),
    completed,
  );
});

test("revocation atomically fails outstanding work and prevents future enqueue", async () => {
  const store = new MemoryBridgeStore();
  const { device } = await store.createDevice("Test Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 60);
  const lease = await store.leaseNext(device.deviceId, 30);
  assert.ok(lease?.leaseId);

  assert.equal(await store.revokeDevice(device.deviceId, new Date().toISOString()), true);
  const failed = await store.getCommand(command.id);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error, "Device revoked before command completed.");
  assert.equal(
    await store.complete(command.id, device.deviceId, lease.leaseId, { online: true }),
    null,
  );
  assert.equal(await store.leaseNext(device.deviceId, 30), null);
  await assert.rejects(
    store.enqueue(device.deviceId, { type: "get_status" }, 60),
    BridgeDeviceUnavailableError,
  );
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
    assert.ok(command.leaseId);
    await store.complete(command.id, device.deviceId, command.leaseId, await demo.getStatus());
  })();

  const status = await remote.getStatus();
  await deviceWorker;
  assert.equal(status.currentChannelId, "beaches");
});
