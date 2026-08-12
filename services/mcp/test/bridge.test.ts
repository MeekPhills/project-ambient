import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonFileBridgeStore, MemoryBridgeStore } from "../src/bridge/store.js";
import { RemoteAmbientAdapter } from "../src/bridge/remote-adapter.js";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import {
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
  BridgeSchemaMigrationError,
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

test("request IDs are canonicalized before persistence and blank IDs are rejected", async () => {
  const store = new MemoryBridgeStore();
  const { device } = await store.createDevice("Test Mac");
  const padded = await store.enqueue(
    device.deviceId,
    { type: "pause", requestId: "  canonical-request-0001  " },
    60,
  );
  assert.equal(padded.requestId, "canonical-request-0001");
  assert.equal(
    (padded.operation as { requestId: string }).requestId,
    "canonical-request-0001",
  );
  assert.equal(
    (await store.enqueue(
      device.deviceId,
      { type: "pause", requestId: "canonical-request-0001" },
      60,
    )).id,
    padded.id,
  );
  await assert.rejects(
    store.enqueue(device.deviceId, { type: "pause", requestId: "                    " }, 60),
  );
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

test("a command is terminally failed after three expired lease attempts", async () => {
  let now = Date.parse("2026-08-12T15:30:00.000Z");
  const store = new MemoryBridgeStore(() => new Date(now));
  const { device } = await store.createDevice("Test Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 120);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const lease = await store.leaseNext(device.deviceId, 10);
    assert.equal(lease?.attemptCount, attempt);
    now += 11_000;
  }
  assert.equal(await store.leaseNext(device.deviceId, 10), null);
  const exhausted = await store.getCommand(command.id);
  assert.equal(exhausted?.status, "failed");
  assert.equal(exhausted?.attemptCount, 3);
  assert.match(exhausted?.error ?? "", /failed after 3 lease attempts/);
});

test("JSON migration terminalizes legacy leases and persists v3 attempt controls", async (t) => {
  const path = join(tmpdir(), `ambient-legacy-${process.pid}-${Date.now()}.json`);
  const createdAt = "2026-08-12T15:30:00.000Z";
  const legacy = {
    devices: [{
      deviceId: "device_legacy",
      displayName: "Legacy Mac",
      tokenHash: "hash",
      enrolledAt: createdAt,
      lastSeenAt: null,
      revokedAt: null,
    }],
    commands: [{
      id: "bridge_legacy",
      deviceId: "device_legacy",
      operation: { type: "get_status" },
      status: "leased",
      createdAt,
      expiresAt: "2026-08-12T16:30:00.000Z",
      leaseExpiresAt: "2026-08-12T15:31:00.000Z",
      leaseId: "lease_legacy",
      result: null,
      error: null,
    }],
  };
  await writeFile(path, JSON.stringify(legacy));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  });

  const store = new JsonFileBridgeStore(path);
  await store.initialize();
  const command = await store.getCommand("bridge_legacy");
  assert.equal(command?.status, "failed");
  assert.equal(command?.attemptCount, 0);
  assert.equal(command?.maxAttempts, 3);
  assert.match(command?.error ?? "", /protocol v2 upgrade/);
  const persisted = JSON.parse(await readFile(path, "utf8")) as { schemaVersion: number };
  assert.equal(persisted.schemaVersion, 3);
});

test("JSON v3 reads preserve a live lease through completion", async (t) => {
  const path = join(tmpdir(), `ambient-v3-${process.pid}-${Date.now()}.json`);
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  });
  const store = new JsonFileBridgeStore(path);
  await store.initialize();
  const { device } = await store.createDevice("Current Mac");
  const command = await store.enqueue(device.deviceId, { type: "get_status" }, 60);
  const lease = await store.leaseNext(device.deviceId, 30);
  assert.equal((await store.getCommand(command.id))?.status, "leased");
  assert.ok(lease?.leaseId);
  assert.equal(
    (await store.complete(command.id, device.deviceId, lease.leaseId, { online: true }))?.status,
    "succeeded",
  );
  const reloaded = new JsonFileBridgeStore(path);
  assert.equal((await reloaded.getCommand(command.id))?.status, "succeeded");
  assert.equal(
    (await reloaded.complete(command.id, device.deviceId, lease.leaseId, { online: true }))?.status,
    "succeeded",
  );
});

test("JSON migration deterministically resolves duplicate and conflicting request IDs", async (t) => {
  const path = join(tmpdir(), `ambient-identity-${process.pid}-${Date.now()}.json`);
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  });
  const createdAt = "2026-08-12T15:30:00.000Z";
  const base = {
    deviceId: "device_legacy",
    createdAt,
    expiresAt: "2026-08-12T16:30:00.000Z",
    leaseExpiresAt: null,
    leaseId: null,
    result: null,
    error: null,
  };
  await writeFile(path, JSON.stringify({
    devices: [{
      deviceId: "device_legacy",
      displayName: "Legacy Mac",
      tokenHash: "hash",
      enrolledAt: createdAt,
      lastSeenAt: null,
      revokedAt: null,
    }],
    commands: [
      {
        ...base,
        id: "duplicate_pending",
        status: "pending",
        operation: { type: "pause", requestId: "duplicate-request-0001" },
      },
      {
        ...base,
        id: "duplicate_succeeded",
        status: "succeeded",
        operation: { type: "pause", requestId: "duplicate-request-0001" },
      },
      {
        ...base,
        id: "mismatch_pending",
        status: "pending",
        requestId: "column-request---0001",
        operation: { type: "pause", requestId: "operation-request-0001" },
      },
    ],
  }));

  const store = new JsonFileBridgeStore(path);
  await store.initialize();
  assert.equal((await store.getCommand("duplicate_succeeded"))?.requestId, "duplicate-request-0001");
  const duplicate = await store.getCommand("duplicate_pending");
  assert.equal(duplicate?.status, "failed");
  assert.equal(duplicate?.requestId, null);
  assert.match(duplicate?.error ?? "", /duplicated/);
  const mismatch = await store.getCommand("mismatch_pending");
  assert.equal(mismatch?.status, "failed");
  assert.equal(mismatch?.requestId, null);
  assert.match(mismatch?.error ?? "", /identifiers disagreed/);
  const reloaded = new JsonFileBridgeStore(path);
  assert.equal((await reloaded.getCommand("duplicate_pending"))?.requestId, null);
  assert.equal((await reloaded.getCommand("mismatch_pending"))?.requestId, null);
});

test("JSON migration caches a typed failure for malformed state", async (t) => {
  const path = join(tmpdir(), `ambient-malformed-${process.pid}-${Date.now()}.json`);
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  });
  await writeFile(path, JSON.stringify({ devices: [{ deviceId: "incomplete" }], commands: [] }));
  const store = new JsonFileBridgeStore(path);
  const initialization = store.initialize();
  await assert.rejects(initialization, BridgeSchemaMigrationError);
  assert.equal(store.initialize(), initialization);
  await assert.rejects(store.initialize(), BridgeSchemaMigrationError);
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
