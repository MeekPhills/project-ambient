import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as z from "zod/v4";
import {
  type AmbientAdapter,
  AmbientAdapterError,
  type AmbientChannel,
  type AmbientChannelSummary,
  type AmbientCommandResult,
  type AmbientHistoryItem,
  type AmbientStatus,
  type CommandContext,
  type DisplayScope,
  type PowerPolicy,
} from "../domain.js";
import {
  channelListSchema,
  channelSchema,
  commandSchema,
  historySchema,
  statusSchema,
} from "../schemas.js";

const execFileAsync = promisify(execFile);

export interface AmbientCtlAdapterOptions {
  executable?: string;
  timeoutMs?: number;
}

function camelCaseKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [camelCaseKey(key), camelize(nested)]),
    );
  }
  return value;
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

export class AmbientCtlAdapter implements AmbientAdapter {
  private readonly executable: string;
  private readonly timeoutMs: number;

  constructor(options: AmbientCtlAdapterOptions = {}) {
    this.executable = options.executable ?? process.env.AMBIENTCTL_PATH ?? "ambientctl";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AMBIENTCTL_TIMEOUT_MS ?? 8_000);
  }

  async getStatus(): Promise<AmbientStatus> {
    return this.run(["status", "--json"], statusSchema);
  }

  async listChannels(): Promise<AmbientChannelSummary[]> {
    return this.run(["channels", "list", "--json"], channelListSchema);
  }

  async getChannel(channelId: string): Promise<AmbientChannel> {
    return this.run(["channels", "get", channelId, "--json"], channelSchema);
  }

  async next(context: CommandContext): Promise<AmbientCommandResult> {
    return this.run(["next", "--request-id", context.requestId, "--json"], commandSchema);
  }

  async activateChannel(input: {
    channelId: string;
    displayScope: DisplayScope;
    durationMinutes?: number;
    requestId: string;
  }): Promise<AmbientCommandResult> {
    const args = [
      "activate",
      input.channelId,
      "--display-scope",
      input.displayScope,
      "--request-id",
      input.requestId,
    ];
    if (input.durationMinutes !== undefined) args.push("--duration", String(input.durationMinutes));
    args.push("--json");
    return this.run(args, commandSchema);
  }

  async pause(input: { durationMinutes?: number; requestId: string }): Promise<AmbientCommandResult> {
    const args = ["pause", "--request-id", input.requestId];
    if (input.durationMinutes !== undefined) args.push("--duration", String(input.durationMinutes));
    args.push("--json");
    return this.run(args, commandSchema);
  }

  async resume(context: CommandContext): Promise<AmbientCommandResult> {
    return this.run(["resume", "--request-id", context.requestId, "--json"], commandSchema);
  }

  async setPowerPolicy(input: { policy: PowerPolicy; requestId: string }): Promise<AmbientCommandResult> {
    return this.run(
      ["power-policy", "set", input.policy, "--request-id", input.requestId, "--json"],
      commandSchema,
    );
  }

  async getHistory(limit: number): Promise<AmbientHistoryItem[]> {
    return this.run(["history", "--limit", String(limit), "--json"], historySchema);
  }

  async restorePrevious(context: CommandContext): Promise<AmbientCommandResult> {
    return this.run(["restore", "--request-id", context.requestId, "--json"], commandSchema);
  }

  private async run<T>(args: string[], schema: z.ZodType<T>): Promise<T> {
    try {
      const { stdout } = await execFileAsync(this.executable, args, {
        timeout: this.timeoutMs,
        maxBuffer: 1_000_000,
        encoding: "utf8",
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          AMBIENT_DATA_DIR: process.env.AMBIENT_DATA_DIR,
        },
      });
      const parsed = JSON.parse(stdout) as unknown;
      return schema.parse(camelize(unwrap(parsed)));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new AmbientAdapterError("Ambient returned an unreadable response.", "invalid_response");
      }
      if (error && typeof error === "object" && "name" in error && error.name === "ZodError") {
        throw new AmbientAdapterError("Ambient returned a response with an unsupported shape.", "invalid_response");
      }
      if (error && typeof error === "object" && "killed" in error && error.killed) {
        throw new AmbientAdapterError("Ambient did not respond before the command timed out.", "timeout");
      }
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        throw new AmbientAdapterError(
          "The Ambient companion command is not installed or AMBIENTCTL_PATH is not configured.",
          "not_available",
        );
      }
      throw new AmbientAdapterError("The Ambient companion could not complete the command.", "command_failed");
    }
  }
}
