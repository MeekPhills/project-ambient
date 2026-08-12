import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { AmbientCtlAdapter } from "../src/adapters/ambientctl.js";
import { AmbientAdapterError } from "../src/domain.js";

const fixture = fileURLToPath(new URL("./fixtures/ambientctl-fixture.mjs", import.meta.url));

async function harness(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ambientctl-adapter-"));
  const logPath = join(directory, "fixture-argv.jsonl");
  await writeFile(logPath, "");
  await chmod(fixture, 0o755);
  const previousDataDirectory = process.env.AMBIENT_DATA_DIR;
  process.env.AMBIENT_DATA_DIR = directory;
  t.after(() => {
    if (previousDataDirectory === undefined) delete process.env.AMBIENT_DATA_DIR;
    else process.env.AMBIENT_DATA_DIR = previousDataDirectory;
  });
  return {
    adapter: new AmbientCtlAdapter({
      executable: fixture,
      now: () => new Date("2026-08-12T15:30:00.000Z"),
      deviceId: "fixture-device",
      displayName: "Fixture Mac",
      appVersion: "0.1.0-test",
    }),
    async argv() {
      const text = await readFile(logPath, "utf8");
      return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    },
  };
}

test("native read envelopes map truthfully and exact argv is fixed", async (t) => {
  const { adapter, argv } = await harness(t);
  const status = await adapter.getStatus();
  const channels = await adapter.listChannels();
  const channel = await adapter.getChannel("channel-beaches");
  const history = await adapter.getHistory(7);

  assert.deepEqual(status, {
    deviceId: "fixture-device",
    displayName: "Fixture Mac",
    appVersion: "0.1.0-test",
    online: true,
    paused: false,
    currentChannelId: "channel-beaches",
    currentChannelName: "Beaches",
    sceneTitle: "Sunrise.jpg",
    winningRule: null,
    explanation: "You selected the Beaches channel.",
    powerPolicy: "adaptive",
    renderer: "still",
    appliedAt: null,
  });
  assert.deepEqual(channels[0]?.rendererCompatibility, ["still", "aerial"]);
  assert.equal(channels[0]?.rightsStatus, "unknown");
  assert.equal(channel.active, true);
  assert.deepEqual(channel.tags, []);
  assert.deepEqual(channel.rules, []);
  assert.deepEqual(channel.sceneTitles, []);
  assert.deepEqual(history, [{
    id: "asset-sunrise",
    position: 1,
    sceneTitle: "Sunrise.jpg",
    mediaKind: "image",
  }]);
  assert.equal(JSON.stringify({ status, channels, channel, history }).includes("/private/secret"), false);
  assert.equal(JSON.stringify({ status, channels, channel, history }).includes("morning"), false);
  const calls = await argv();
  assert.deepEqual(calls[0], ["status", "--json"]);
  assert.deepEqual(calls.slice(1, 3).sort(), [
    ["channels", "list", "--json"],
    ["status", "--json"],
  ].sort());
  assert.deepEqual(calls.slice(3, 5).sort(), [
    ["channels", "get", "channel-beaches", "--json"],
    ["status", "--json"],
  ].sort());
  assert.deepEqual(calls[5], ["history", "--limit", "7", "--json"]);
});

test("all six native mutations use exact argv, seconds, and policy translations", async (t) => {
  const { adapter, argv } = await harness(t);
  const next = await adapter.next({ requestId: "request-next-00000001" });
  const activate = await adapter.activateChannel({
    channelId: "channel-nature",
    displayScope: "primary",
    durationMinutes: 12,
    requestId: "request-activate-0001",
  });
  const pause = await adapter.pause({ durationMinutes: 30, requestId: "request-pause-0000001" });
  await adapter.resume({ requestId: "request-resume-000001" });
  const still = await adapter.setPowerPolicy({ policy: "still", requestId: "request-still-0000001" });
  const adaptive = await adapter.setPowerPolicy({ policy: "adaptive", requestId: "request-adaptive-0001" });
  const quality = await adapter.setPowerPolicy({ policy: "always_live", requestId: "request-quality-00001" });
  const restore = await adapter.restorePrevious({ requestId: "request-restore-00001" });

  assert.match(next.commandId, /^cmd_[0-9a-f]{12}$/);
  assert.equal(next.appliedAt, "2026-08-12T15:30:00.000Z");
  assert.equal(activate.effectiveChannelId, "channel-nature");
  assert.equal(pause.paused, true);
  assert.equal(still.effectivePowerPolicy, "still");
  assert.equal(adaptive.effectivePowerPolicy, "adaptive");
  assert.equal(quality.effectivePowerPolicy, "always_live");
  assert.equal(restore.message, "Restored the wallpapers that were active before Project Ambient.");
  assert.equal(restore.paused, true);
  assert.equal(restore.undoAvailable, false);
  assert.equal(next.undoAvailable, false);
  assert.deepEqual(await argv(), [
    ["next", "--request-id", "request-next-00000001", "--json"], ["status", "--json"],
    ["activate", "channel-nature", "--display-scope", "primary", "--request-id", "request-activate-0001", "--duration", "720", "--json"], ["status", "--json"],
    ["pause", "--request-id", "request-pause-0000001", "--duration", "1800", "--json"], ["status", "--json"],
    ["resume", "--request-id", "request-resume-000001", "--json"], ["status", "--json"],
    ["power-policy", "set", "efficiency", "--request-id", "request-still-0000001", "--json"], ["status", "--json"],
    ["power-policy", "set", "automatic", "--request-id", "request-adaptive-0001", "--json"], ["status", "--json"],
    ["power-policy", "set", "quality", "--request-id", "request-quality-00001", "--json"], ["status", "--json"],
    ["restore", "--request-id", "request-restore-00001", "--json"], ["status", "--json"],
  ]);
});

test("same-process retries keep stable command IDs while native request IDs stay authoritative", async (t) => {
  const { adapter, argv } = await harness(t);
  const requestId = "request-replay-0000001";
  const first = await adapter.pause({ requestId });
  const replay = await adapter.pause({ requestId });
  assert.equal(first.status, "applied");
  assert.equal(replay.status, "already_applied");
  assert.equal(first.commandId, replay.commandId);
  assert.equal((await argv()).length, 2, "replay does not execute or status-read twice");

  await assert.rejects(
    adapter.resume({ requestId }),
    (error: unknown) => error instanceof AmbientAdapterError
      && error.code === "command_failed"
      && /different Ambient command/.test(error.message),
  );
  assert.equal((await argv()).length, 2, "conflicting reuse is rejected without mutating native state");
});

test("native error envelopes map to bounded adapter errors", async (t) => {
  const { adapter } = await harness(t);
  await assert.rejects(
    adapter.getChannel("missing"),
    (error: unknown) => error instanceof AmbientAdapterError
      && error.code === "not_found"
      && !error.message.includes("private"),
  );
});

test("built native ambientctl envelopes cover all ten adapter operations when available", {
  skip: process.platform !== "darwin" ? "ambientctl is a macOS companion" : false,
}, async (t) => {
  const executable = resolve(fileURLToPath(new URL("../../../apps/macos/.build/debug/ambientctl", import.meta.url)));
  try {
    await chmod(executable, 0o755);
  } catch {
    t.skip("build apps/macos ambientctl to run the native contract smoke test");
    return;
  }
  const dataDirectory = await mkdtemp(join(tmpdir(), "ambientctl-native-contract-"));
  const previousDataDirectory = process.env.AMBIENT_DATA_DIR;
  process.env.AMBIENT_DATA_DIR = dataDirectory;
  t.after(() => {
    if (previousDataDirectory === undefined) delete process.env.AMBIENT_DATA_DIR;
    else process.env.AMBIENT_DATA_DIR = previousDataDirectory;
  });
  const adapter = new AmbientCtlAdapter({
    executable,
    deviceId: "native-smoke-device",
    displayName: "Native Smoke Mac",
    appVersion: "native-smoke",
  });
  const status = await adapter.getStatus();
  const channels = await adapter.listChannels();
  const activeChannelId = status.currentChannelId;
  assert.ok(activeChannelId);
  const channel = await adapter.getChannel(activeChannelId);
  const history = await adapter.getHistory(5);

  const acceptsNativeOutcome = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      // An empty isolated library can truthfully reject next/activate, and a
      // headless macOS runner can reject restore. The contract requirement is
      // that native envelopes map to a command outcome, never invalid_response.
      assert.ok(error instanceof AmbientAdapterError);
      assert.equal(error.code, "command_failed");
    }
  };
  await acceptsNativeOutcome(() => adapter.next({ requestId: "native-smoke-next-0001" }));
  await acceptsNativeOutcome(() => adapter.activateChannel({
    channelId: activeChannelId,
    displayScope: "all",
    requestId: "native-smoke-activate-01",
  }));
  await acceptsNativeOutcome(() => adapter.pause({ requestId: "native-smoke-pause-0001" }));
  await acceptsNativeOutcome(() => adapter.resume({ requestId: "native-smoke-resume-001" }));
  await acceptsNativeOutcome(() => adapter.setPowerPolicy({
    policy: "adaptive",
    requestId: "native-smoke-policy-001",
  }));
  await acceptsNativeOutcome(() => adapter.restorePrevious({ requestId: "native-smoke-restore-01" }));

  assert.equal(status.online, true);
  assert.equal(status.powerPolicy, "adaptive");
  assert.equal(status.currentChannelName, "All backgrounds");
  assert.ok(channels.length >= 6);
  assert.equal(channels.find((candidate) => candidate.id === activeChannelId)?.active, true);
  assert.equal(channel.id, activeChannelId);
  assert.deepEqual(history, []);
});
