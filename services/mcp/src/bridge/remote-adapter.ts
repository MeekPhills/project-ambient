import type {
  AmbientAdapter,
  AmbientChannel,
  AmbientChannelSummary,
  AmbientCommandResult,
  AmbientHistoryItem,
  AmbientStatus,
  CommandContext,
  DisplayScope,
  PowerPolicy,
} from "../domain.js";
import { AmbientAdapterError } from "../domain.js";
import type { BridgeOperation, BridgeStore } from "./types.js";
import { BridgeDeviceUnavailableError, BridgeRequestConflictError } from "./types.js";
import {
  channelListSchema,
  channelSchema,
  commandSchema,
  historySchema,
  statusSchema,
} from "../schemas.js";
import type * as z from "zod/v4";

export interface RemoteAmbientAdapterOptions {
  store: BridgeStore;
  deviceId: string;
  commandTtlSeconds?: number;
  resultTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class RemoteAmbientAdapter implements AmbientAdapter {
  private readonly commandTtlSeconds: number;
  private readonly resultTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly options: RemoteAmbientAdapterOptions) {
    this.commandTtlSeconds = options.commandTtlSeconds ?? 60;
    this.resultTimeoutMs = options.resultTimeoutMs ?? 25_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
  }

  getStatus(): Promise<AmbientStatus> {
    return this.execute({ type: "get_status" }, statusSchema);
  }

  listChannels(): Promise<AmbientChannelSummary[]> {
    return this.execute({ type: "list_channels" }, channelListSchema);
  }

  getChannel(channelId: string): Promise<AmbientChannel> {
    return this.execute({ type: "get_channel", channelId }, channelSchema);
  }

  next(context: CommandContext): Promise<AmbientCommandResult> {
    return this.execute({ type: "next", requestId: context.requestId }, commandSchema);
  }

  activateChannel(input: {
    channelId: string;
    displayScope: DisplayScope;
    durationMinutes?: number;
    requestId: string;
  }): Promise<AmbientCommandResult> {
    return this.execute(
      {
        type: "activate_channel",
        channelId: input.channelId,
        displayScope: input.displayScope,
        ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
        requestId: input.requestId,
      },
      commandSchema,
    );
  }

  pause(input: { durationMinutes?: number; requestId: string }): Promise<AmbientCommandResult> {
    return this.execute(
      {
        type: "pause",
        ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
        requestId: input.requestId,
      },
      commandSchema,
    );
  }

  resume(context: CommandContext): Promise<AmbientCommandResult> {
    return this.execute({ type: "resume", requestId: context.requestId }, commandSchema);
  }

  setPowerPolicy(input: { policy: PowerPolicy; requestId: string }): Promise<AmbientCommandResult> {
    return this.execute(
      { type: "set_power_policy", policy: input.policy, requestId: input.requestId },
      commandSchema,
    );
  }

  getHistory(limit: number): Promise<AmbientHistoryItem[]> {
    return this.execute({ type: "get_history", limit }, historySchema);
  }

  restorePrevious(context: CommandContext): Promise<AmbientCommandResult> {
    return this.execute({ type: "restore_previous", requestId: context.requestId }, commandSchema);
  }

  private async execute<T>(operation: BridgeOperation, schema: z.ZodType<T>): Promise<T> {
    const device = await this.options.store.getDevice(this.options.deviceId);
    if (!device || device.revokedAt) {
      throw new AmbientAdapterError("The selected Ambient device is not enrolled.", "not_available");
    }
    let command;
    try {
      command = await this.options.store.enqueue(
        this.options.deviceId,
        operation,
        this.commandTtlSeconds,
      );
    } catch (error) {
      if (error instanceof BridgeDeviceUnavailableError) {
        throw new AmbientAdapterError("The selected Ambient device is not enrolled.", "not_available");
      }
      if (error instanceof BridgeRequestConflictError) {
        throw new AmbientAdapterError(
          "This request ID was already used for a different Ambient command.",
          "command_failed",
        );
      }
      throw error;
    }
    const deadline = Date.now() + this.resultTimeoutMs;
    while (Date.now() < deadline) {
      const current = await this.options.store.getCommand(command.id);
      if (!current) throw new AmbientAdapterError("The remote Ambient command was lost.", "command_failed");
      if (current.status === "succeeded") {
        const parsed = schema.safeParse(current.result);
        if (!parsed.success) {
          throw new AmbientAdapterError("The Ambient device returned an unsupported result.", "invalid_response");
        }
        return parsed.data;
      }
      if (current.status === "failed") {
        throw new AmbientAdapterError(current.error ?? "The Ambient device rejected the command.", "command_failed");
      }
      if (current.status === "expired") {
        throw new AmbientAdapterError("The remote Ambient command expired before delivery.", "timeout");
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new AmbientAdapterError("The Ambient device did not return a result in time.", "timeout");
  }
}
