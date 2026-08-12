import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { promisify } from "node:util";
import * as z from "zod/v4";
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
  type Renderer,
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
  now?: () => Date;
  deviceId?: string;
  displayName?: string;
  appVersion?: string;
}

const nativePowerPolicySchema = z.enum(["automatic", "efficiency", "quality"]);
type NativePowerPolicy = z.infer<typeof nativePowerPolicySchema>;

const nativeChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  symbol: z.string(),
  kind: z.enum(["smart", "manual"]),
  includeTags: z.array(z.string()),
  assetIDs: z.array(z.string()),
  isEnabled: z.boolean(),
});

const nativeAssetSchema = z.object({
  id: z.string().min(1),
  fileName: z.string(),
  kind: z.enum(["image", "video"]),
  tags: z.array(z.string()),
  importedAt: z.string(),
  modifiedAt: z.string().optional(),
  // Deliberately do not model or forward the native `path` field. Zod strips
  // that native-only field before any marketplace mapping runs.
});

const nativeChannelSummarySchema = z.object({
  channel: nativeChannelSchema,
  assetCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
});

const nativeNowNextSchema = z.object({
  channel: nativeChannelSchema.optional(),
  now: nativeAssetSchema.optional(),
  next: nativeAssetSchema.optional(),
  why: z.string(),
  isLowPowerModeEnabled: z.boolean(),
  effectiveMode: z.string(),
});

const nativeStatusEnvelopeSchema = z.object({
  ok: z.literal(true),
  playbackStatus: z.enum(["playing", "paused"]),
  powerPolicy: nativePowerPolicySchema,
  libraryFolderCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  lastScanAt: z.string().optional(),
  status: nativeNowNextSchema,
});

const nativeChannelsEnvelopeSchema = z.object({
  ok: z.literal(true),
  channels: z.array(nativeChannelSummarySchema),
});

const nativeChannelEnvelopeSchema = z.object({
  ok: z.literal(true),
  result: nativeChannelSummarySchema,
});

const nativeMutationEnvelopeSchema = z.object({
  ok: z.boolean(),
  action: z.string(),
  requestID: z.string().optional(),
  message: z.string(),
  channel: nativeChannelSchema.optional(),
  asset: nativeAssetSchema.optional(),
  expiresAt: z.string().optional(),
});

const nativeHistoryEnvelopeSchema = z.object({
  ok: z.literal(true),
  items: z.array(z.object({
    position: z.number().int().positive(),
    asset: nativeAssetSchema,
  })),
});

const nativeErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.string().min(1),
});

function fromNativePolicy(policy: NativePowerPolicy): PowerPolicy {
  switch (policy) {
    case "automatic": return "adaptive";
    case "efficiency": return "still";
    case "quality": return "always_live";
  }
}

function toNativePolicy(policy: PowerPolicy): NativePowerPolicy {
  switch (policy) {
    case "adaptive": return "automatic";
    case "still": return "efficiency";
    case "always_live": return "quality";
  }
}

function rendererFor(asset: z.infer<typeof nativeAssetSchema> | undefined): Renderer {
  // Renderer means what is on the desktop now, not what the selected power
  // policy might permit later.
  return asset?.kind === "video" ? "aerial" : "still";
}

function rendererCompatibility(summary: z.infer<typeof nativeChannelSummarySchema>): Renderer[] {
  const renderers: Renderer[] = [];
  if (summary.imageCount > 0) renderers.push("still");
  if (summary.videoCount > 0) renderers.push("aerial");
  return renderers;
}

function commandId(requestId: string): string {
  return `cmd_${createHash("sha256").update(requestId).digest("hex").slice(0, 12)}`;
}

function stableDeviceId(): string {
  return `ambient-mac-${createHash("sha256").update(hostname()).digest("hex").slice(0, 12)}`;
}

function isExecutionError(error: unknown): error is Error & {
  code?: string;
  killed?: boolean;
  stderr?: string;
} {
  return error instanceof Error;
}

export class AmbientCtlAdapter implements AmbientAdapter {
  private static readonly maximumCompletedEntries = 128;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly deviceId: string;
  private readonly displayName: string;
  private readonly appVersion: string;
  private readonly completed = new Map<string, { fingerprint: string; result: AmbientCommandResult }>();

  constructor(options: AmbientCtlAdapterOptions = {}) {
    this.executable = options.executable ?? process.env.AMBIENTCTL_PATH ?? "ambientctl";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AMBIENTCTL_TIMEOUT_MS ?? 8_000);
    this.now = options.now ?? (() => new Date());
    this.deviceId = options.deviceId ?? process.env.AMBIENT_DEVICE_ID ?? stableDeviceId();
    this.displayName = options.displayName ?? hostname();
    this.appVersion = options.appVersion ?? process.env.AMBIENT_APP_VERSION ?? "unknown";
  }

  async getStatus(): Promise<AmbientStatus> {
    const native = await this.run(["status", "--json"], nativeStatusEnvelopeSchema);
    return this.mapStatus(native);
  }

  async listChannels(): Promise<AmbientChannelSummary[]> {
    const [native, status] = await Promise.all([
      this.run(["channels", "list", "--json"], nativeChannelsEnvelopeSchema),
      this.getStatus(),
    ]);
    return channelListSchema.parse(native.channels.map((item) => this.mapChannelSummary(item, status.currentChannelId)));
  }

  async getChannel(channelId: string): Promise<AmbientChannel> {
    const [native, status] = await Promise.all([
      this.run(["channels", "get", channelId, "--json"], nativeChannelEnvelopeSchema),
      this.getStatus(),
    ]);
    return channelSchema.parse(this.mapChannel(native.result, status));
  }

  async next(context: CommandContext): Promise<AmbientCommandResult> {
    return this.mutate(["next", "--request-id", context.requestId, "--json"], context.requestId);
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
    if (input.durationMinutes !== undefined) args.push("--duration", String(input.durationMinutes * 60));
    args.push("--json");
    return this.mutate(args, input.requestId);
  }

  async pause(input: { durationMinutes?: number; requestId: string }): Promise<AmbientCommandResult> {
    const args = ["pause", "--request-id", input.requestId];
    if (input.durationMinutes !== undefined) args.push("--duration", String(input.durationMinutes * 60));
    args.push("--json");
    return this.mutate(args, input.requestId);
  }

  async resume(context: CommandContext): Promise<AmbientCommandResult> {
    return this.mutate(["resume", "--request-id", context.requestId, "--json"], context.requestId);
  }

  async setPowerPolicy(input: { policy: PowerPolicy; requestId: string }): Promise<AmbientCommandResult> {
    return this.mutate(
      ["power-policy", "set", toNativePolicy(input.policy), "--request-id", input.requestId, "--json"],
      input.requestId,
    );
  }

  async getHistory(limit: number): Promise<AmbientHistoryItem[]> {
    const native = await this.run(["history", "--limit", String(limit), "--json"], nativeHistoryEnvelopeSchema);
    return historySchema.parse(native.items.map(({ position, asset }) => ({
      id: asset.id,
      position,
      sceneTitle: asset.fileName,
      mediaKind: asset.kind,
    })));
  }

  async restorePrevious(context: CommandContext): Promise<AmbientCommandResult> {
    return this.mutate(["restore", "--request-id", context.requestId, "--json"], context.requestId);
  }

  private mapStatus(native: z.infer<typeof nativeStatusEnvelopeSchema>): AmbientStatus {
    return statusSchema.parse({
      deviceId: this.deviceId,
      displayName: this.displayName,
      appVersion: this.appVersion,
      online: true,
      paused: native.playbackStatus === "paused",
      currentChannelId: native.status.channel?.id ?? null,
      currentChannelName: native.status.channel?.name ?? null,
      sceneTitle: native.status.now?.fileName ?? null,
      winningRule: null,
      explanation: native.status.why,
      powerPolicy: fromNativePolicy(native.powerPolicy),
      renderer: rendererFor(native.status.now),
      // Native status does not expose a trustworthy wallpaper application time.
      appliedAt: null,
    });
  }

  private mapChannelSummary(
    native: z.infer<typeof nativeChannelSummarySchema>,
    activeChannelId: string | null,
  ): AmbientChannelSummary {
    return {
      id: native.channel.id,
      name: native.channel.name,
      description: native.channel.includeTags.length > 0
        ? "Smart channel backed by matching media in the local Ambient library."
        : "All compatible media in the local Ambient library.",
      mediaCount: native.assetCount,
      rendererCompatibility: rendererCompatibility(native),
      rightsStatus: "unknown",
      active: native.channel.id === activeChannelId,
    };
  }

  private mapChannel(
    native: z.infer<typeof nativeChannelSummarySchema>,
    status: AmbientStatus,
  ): AmbientChannel {
    return {
      ...this.mapChannelSummary(native, status.currentChannelId),
      // Matching tags stay local; the native endpoint does not distinguish
      // public labels from private user classification.
      tags: [],
      // The native channel endpoint has no rule or scene-title list. Empty
      // values are truthful and avoid inventing private library metadata.
      rules: [],
      powerPolicy: status.powerPolicy,
      sceneTitles: [],
    };
  }

  private async mutate(args: string[], requestId: string): Promise<AmbientCommandResult> {
    const fingerprint = JSON.stringify(args.filter((argument) => argument !== "--json"));
    const replay = this.completed.get(requestId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new AmbientAdapterError(
          "This request ID was already used for a different Ambient command.",
          "command_failed",
        );
      }
      return commandSchema.parse({ ...replay.result, status: "already_applied" });
    }

    const native = await this.run(args, nativeMutationEnvelopeSchema);
    if (!native.ok) {
      throw new AmbientAdapterError(native.message, "command_failed");
    }
    if (native.requestID !== undefined && native.requestID !== requestId) {
      throw new AmbientAdapterError("Ambient returned a mismatched request ID.", "invalid_response");
    }
    const status = await this.getStatus();
    const result = commandSchema.parse({
      commandId: commandId(requestId),
      status: "applied",
      message: native.message,
      requestId: native.requestID ?? requestId,
      effectiveChannelId: status.currentChannelId,
      effectivePowerPolicy: status.powerPolicy,
      paused: status.paused,
      // Native status does not expose whether pre-Ambient wallpaper capture is
      // available. Do not advertise undo on an unsupported inference.
      undoAvailable: false,
      // The native mutation does not expose an application timestamp. This is
      // the adapter observation time, not a fabricated persisted event time.
      appliedAt: this.now().toISOString(),
    });
    this.completed.set(requestId, { fingerprint, result });
    if (this.completed.size > AmbientCtlAdapter.maximumCompletedEntries) {
      const oldest = this.completed.keys().next().value;
      if (oldest !== undefined) this.completed.delete(oldest);
    }
    return result;
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
      return schema.parse(JSON.parse(stdout) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new AmbientAdapterError("Ambient returned an unreadable response.", "invalid_response");
      }
      if (error instanceof z.ZodError) {
        throw new AmbientAdapterError("Ambient returned a response with an unsupported shape.", "invalid_response");
      }
      if (isExecutionError(error) && error.killed) {
        throw new AmbientAdapterError("Ambient did not respond before the command timed out.", "timeout");
      }
      if (isExecutionError(error) && error.code === "ENOENT") {
        throw new AmbientAdapterError(
          "The Ambient companion command is not installed or AMBIENTCTL_PATH is not configured.",
          "not_available",
        );
      }
      if (isExecutionError(error) && typeof error.stderr === "string") {
        try {
          const native = nativeErrorEnvelopeSchema.parse(JSON.parse(error.stderr) as unknown);
          if (/no channel matches/i.test(native.error)) {
            throw new AmbientAdapterError("That Ambient channel was not found.", "not_found");
          }
          if (/request id .*already used/i.test(native.error)) {
            throw new AmbientAdapterError(
              "This request ID was already used for a different Ambient command.",
              "command_failed",
            );
          }
          // Native errors can include local file paths. Preserve failure
          // semantics without forwarding those details over MCP.
          throw new AmbientAdapterError(
            "Ambient rejected the command. Check the local app for details.",
            "command_failed",
          );
        } catch (nested) {
          if (nested instanceof AmbientAdapterError) throw nested;
        }
      }
      throw new AmbientAdapterError("The Ambient companion could not complete the command.", "command_failed");
    }
  }
}
