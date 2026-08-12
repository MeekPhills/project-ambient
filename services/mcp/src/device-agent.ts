#!/usr/bin/env node
import { AmbientCtlAdapter } from "./adapters/ambientctl.js";
import type { BridgeCommand, BridgeOperation } from "./bridge/types.js";
import { bridgeOperationSchema } from "./bridge/types.js";
import { log } from "./logger.js";

const configuredBridgeUrl = process.env.AMBIENT_BRIDGE_URL?.replace(/\/$/, "");
const deviceId = process.env.AMBIENT_DEVICE_ID;
const deviceToken = process.env.AMBIENT_DEVICE_TOKEN;
const pollIntervalMs = Number(process.env.AMBIENT_BRIDGE_POLL_MS ?? 1_500);

if (!configuredBridgeUrl || !configuredBridgeUrl.startsWith("https://")) {
  throw new Error("AMBIENT_BRIDGE_URL must be an HTTPS URL.");
}
const bridgeUrl: string = configuredBridgeUrl;
if (!deviceId || !deviceToken) {
  throw new Error("AMBIENT_DEVICE_ID and AMBIENT_DEVICE_TOKEN are required.");
}
if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) {
  throw new Error("AMBIENT_BRIDGE_POLL_MS must be between 250 and 60000.");
}

const adapter = new AmbientCtlAdapter();
const headers = {
  authorization: `Bearer ${deviceToken}`,
  "x-ambient-device-id": deviceId,
};
let stopped = false;

async function execute(operation: BridgeOperation): Promise<unknown> {
  switch (operation.type) {
    case "get_status":
      return adapter.getStatus();
    case "list_channels":
      return adapter.listChannels();
    case "get_channel":
      return adapter.getChannel(operation.channelId);
    case "next":
      return adapter.next({ requestId: operation.requestId });
    case "activate_channel":
      return adapter.activateChannel({
        channelId: operation.channelId,
        displayScope: operation.displayScope,
        ...(operation.durationMinutes === undefined ? {} : { durationMinutes: operation.durationMinutes }),
        requestId: operation.requestId,
      });
    case "pause":
      return adapter.pause({
        ...(operation.durationMinutes === undefined ? {} : { durationMinutes: operation.durationMinutes }),
        requestId: operation.requestId,
      });
    case "resume":
      return adapter.resume({ requestId: operation.requestId });
    case "set_power_policy":
      return adapter.setPowerPolicy({ policy: operation.policy, requestId: operation.requestId });
    case "get_history":
      return adapter.getHistory(operation.limit);
    case "restore_previous":
      return adapter.restorePrevious({ requestId: operation.requestId });
  }
}

async function postResult(command: BridgeCommand, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${bridgeUrl}/bridge/v1/agent/commands/${encodeURIComponent(command.id)}/result`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Bridge rejected result with HTTP ${response.status}.`);
}

async function pollOnce(): Promise<void> {
  const response = await fetch(`${bridgeUrl}/bridge/v1/agent/commands/next`, {
    headers,
    signal: AbortSignal.timeout(35_000),
  });
  if (response.status === 204) return;
  if (!response.ok) throw new Error(`Bridge poll failed with HTTP ${response.status}.`);
  const body = await response.json() as { command?: BridgeCommand };
  if (!body.command) throw new Error("Bridge response did not include a command.");
  const parsed = bridgeOperationSchema.safeParse(body.command.operation);
  if (!parsed.success) {
    await postResult(body.command, { status: "failed", error: "Unsupported bridge operation." });
    return;
  }
  try {
    const result = await execute(parsed.data);
    await postResult(body.command, { status: "succeeded", result });
    log("info", "device_command_succeeded", { commandId: body.command.id, operation: parsed.data.type });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Device command failed.";
    await postResult(body.command, { status: "failed", error: message });
    log("warn", "device_command_failed", { commandId: body.command.id, operation: parsed.data.type });
  }
}

async function main(): Promise<void> {
  log("info", "device_agent_started", { deviceId, bridgeHost: new URL(bridgeUrl).host });
  while (!stopped) {
    try {
      await pollOnce();
    } catch (error) {
      log("warn", "device_poll_failed", { errorType: error instanceof Error ? error.name : typeof error });
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

await main();
