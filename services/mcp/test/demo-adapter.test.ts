import assert from "node:assert/strict";
import test from "node:test";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import { AmbientAdapterError } from "../src/domain.js";

const clock = () => new Date("2026-08-12T15:30:00.000Z");

test("demo adapter is deterministic and command retries are idempotent", async () => {
  const adapter = new DemoAmbientAdapter(clock);
  const requestId = "test-request-00000001";

  const first = await adapter.activateChannel({
    channelId: "quiet-nature",
    displayScope: "all",
    requestId,
  });
  const retry = await adapter.activateChannel({
    channelId: "beaches",
    displayScope: "primary",
    requestId,
  });

  assert.equal(first.status, "applied");
  assert.equal(first.appliedAt, "2026-08-12T15:30:00.000Z");
  assert.equal(retry.status, "already_applied");
  assert.equal(retry.commandId, first.commandId);
  assert.equal(retry.effectiveChannelId, "quiet-nature");
});

test("demo adapter rejects unknown channels", async () => {
  const adapter = new DemoAmbientAdapter(clock);
  await assert.rejects(
    () => adapter.getChannel("missing-channel"),
    (error: unknown) => error instanceof AmbientAdapterError && error.code === "not_found",
  );
});

test("demo adapter records mutations in history", async () => {
  const adapter = new DemoAmbientAdapter(clock);
  await adapter.next({ requestId: "test-request-00000002" });
  const [latest] = await adapter.getHistory(1);
  assert.equal(latest?.action, "next");
  assert.equal(latest?.occurredAt, "2026-08-12T15:30:00.000Z");
  assert.equal(latest?.restorable, true);
});
