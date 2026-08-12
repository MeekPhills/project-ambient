#!/usr/bin/env node
import { AmbientCtlAdapter } from "./adapters/ambientctl.js";
import type { BridgeOperation } from "./bridge/types.js";
import { bridgeOperationSchema } from "./bridge/types.js";
import { BRIDGE_PROTOCOL_VERSION, BRIDGE_REQUIRED_CAPABILITY } from "./bridge/types.js";
import { deliverPendingBridgeResult, retryAfterMilliseconds } from "./bridge/result-delivery.js";
import { log } from "./logger.js";
import * as z from "zod/v4";

const commandEnvelopeSchema = z.object({
  id: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  leaseId: z.string().min(1).max(128),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  leaseExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  operation: z.unknown(),
});
type DeviceCommand = z.infer<typeof commandEnvelopeSchema>;

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
  "x-ambient-protocol-version": String(BRIDGE_PROTOCOL_VERSION),
  "x-ambient-capabilities": BRIDGE_REQUIRED_CAPABILITY,
};
let stopped = false;

class BridgeHttpError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "BridgeHttpError";
  }
}

function assertProtocolResponse(response: Response): void {
  if (
    response.headers.get("x-ambient-protocol-version") !== String(BRIDGE_PROTOCOL_VERSION)
    || !response.headers.get("x-ambient-capabilities")
      ?.split(",")
      .map((capability) => capability.trim())
      .includes(BRIDGE_REQUIRED_CAPABILITY)
  ) {
    throw new Error("Bridge response did not declare protocol v2 lease fencing.");
  }
}

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

async function postResult(command: DeviceCommand, body: Record<string, unknown>): Promise<void> {
  await deliverPendingBridgeResult(
    {
      commandId: command.id,
      leaseId: command.leaseId,
      leaseExpiresAt: command.leaseExpiresAt,
      expiresAt: command.expiresAt,
      body,
    },
    {
      url: bridgeUrl,
      headers,
      fetch,
      now: Date.now,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      baseRetryMs: pollIntervalMs,
      assertProtocol: assertProtocolResponse,
    },
  );
}

async function pollOnce(): Promise<void> {
  const response = await fetch(`${bridgeUrl}/bridge/v1/agent/commands/next`, {
    headers,
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) {
    throw new BridgeHttpError(
      `Bridge poll failed with HTTP ${response.status}.`,
      retryAfterMilliseconds(response),
    );
  }
  assertProtocolResponse(response);
  if (response.status === 204) return;
  const body = z.object({ command: commandEnvelopeSchema }).safeParse(await response.json());
  if (!body.success || body.data.command.deviceId !== deviceId) {
    throw new Error("Bridge response did not include a valid command lease.");
  }
  const command = body.data.command;
  const parsed = bridgeOperationSchema.safeParse(command.operation);
  if (!parsed.success) {
    await postResult(command, { status: "failed", error: "Unsupported bridge operation." });
    return;
  }
  let result: unknown;
  try {
    result = await execute(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Device command failed.";
    await postResult(command, { status: "failed", error: message });
    log("warn", "device_command_failed", { commandId: command.id, operation: parsed.data.type });
    return;
  }
  await postResult(command, { status: "succeeded", result });
  log("info", "device_command_succeeded", { commandId: command.id, operation: parsed.data.type });
}

async function main(): Promise<void> {
  log("info", "device_agent_started", { deviceId, bridgeHost: new URL(bridgeUrl).host });
  let consecutivePollFailures = 0;
  while (!stopped) {
    try {
      await pollOnce();
      consecutivePollFailures = 0;
    } catch (error) {
      consecutivePollFailures += 1;
      log("warn", "device_poll_failed", { errorType: error instanceof Error ? error.name : typeof error });
      const serverRetryDelayMs = error instanceof BridgeHttpError ? error.retryAfterMs : 0;
      const backoffMultiplier = 2 ** Math.min(Math.max(consecutivePollFailures - 1, 0), 5);
      const nextPollDelayMs = Math.max(
        Math.min(pollIntervalMs * backoffMultiplier, 60_000),
        serverRetryDelayMs,
      );
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, nextPollDelayMs));
      continue;
    }
    const backoffMultiplier = 2 ** Math.min(Math.max(consecutivePollFailures - 1, 0), 5);
    const nextPollDelayMs = Math.min(pollIntervalMs * backoffMultiplier, 60_000);
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, nextPollDelayMs));
  }
}

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

await main();
