import { createHash } from "node:crypto";
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

const CHANNELS: AmbientChannel[] = [
  {
    id: "beaches",
    name: "Beaches",
    description: "Calm coastlines, clear water, and low-motion shoreline scenes.",
    mediaCount: 12,
    rendererCompatibility: ["still", "aerial"],
    rightsStatus: "user_owned",
    active: true,
    tags: ["beach", "ocean", "coast", "calm"],
    rules: ["Weekdays before 9:00 AM", "When Focus is Personal"],
    powerPolicy: "adaptive",
    sceneTitles: ["Cape May Sunrise", "Turquoise Water", "Quiet Dunes"],
  },
  {
    id: "philadelphia-sports",
    name: "Philadelphia Sports",
    description: "Personal Philadelphia game-day memories and celebration moments.",
    mediaCount: 24,
    rendererCompatibility: ["still", "aerial"],
    rightsStatus: "user_owned",
    active: false,
    tags: ["philadelphia", "sports", "game-day", "celebration"],
    rules: ["Game-day evenings", "Manual activation"],
    powerPolicy: "adaptive",
    sceneTitles: ["Broad Street Celebration", "Ballpark Lights", "Sunday Kickoff"],
  },
  {
    id: "quiet-nature",
    name: "Quiet Nature",
    description: "Forests, mountains, and slow seasonal landscapes for focused work.",
    mediaCount: 18,
    rendererCompatibility: ["still", "aerial", "native_live"],
    rightsStatus: "user_owned",
    active: false,
    tags: ["forest", "mountain", "nature", "focus"],
    rules: ["Weekdays from 9:00 AM to 5:00 PM"],
    powerPolicy: "still",
    sceneTitles: ["Misty Pines", "Autumn Ridge", "Blue Hour Lake"],
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function commandId(requestId: string): string {
  return `cmd_${createHash("sha256").update(requestId).digest("hex").slice(0, 12)}`;
}

export class DemoAmbientAdapter implements AmbientAdapter {
  private static readonly maximumCompletedEntries = 128;
  private status: AmbientStatus;
  private readonly history: AmbientHistoryItem[];
  private readonly commands = new Map<string, { fingerprint: string; result: AmbientCommandResult }>();
  private sceneIndex = 0;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.status = {
      deviceId: "ambient-demo-mac",
      displayName: "Review Mac",
      appVersion: "0.1.0-demo",
      online: true,
      paused: false,
      currentChannelId: "beaches",
      currentChannelName: "Beaches",
      sceneTitle: "Cape May Sunrise",
      winningRule: "Morning calm",
      explanation: "Beaches is active because the morning rule outranked the default channel.",
      powerPolicy: "adaptive",
      renderer: "still",
      appliedAt: "2026-08-12T12:00:00.000Z",
    };
    this.history = [
      {
        id: "asset_cape-may-sunrise",
        position: 1,
        sceneTitle: "Cape May Sunrise",
        mediaKind: "image",
      },
      {
        id: "asset_ballpark-lights",
        position: 2,
        sceneTitle: "Ballpark Lights",
        mediaKind: "image",
      },
      {
        id: "asset_misty-pines",
        position: 3,
        sceneTitle: "Misty Pines",
        mediaKind: "image",
      },
    ];
  }

  async getStatus(): Promise<AmbientStatus> {
    return clone(this.status);
  }

  async listChannels(): Promise<AmbientChannelSummary[]> {
    return CHANNELS.map((channel) => ({
      ...clone(channel),
      active: channel.id === this.status.currentChannelId,
    }));
  }

  async getChannel(channelId: string): Promise<AmbientChannel> {
    const channel = CHANNELS.find((candidate) => candidate.id === channelId);
    if (!channel) {
      throw new AmbientAdapterError(`Channel '${channelId}' was not found.`, "not_found");
    }
    return { ...clone(channel), active: channel.id === this.status.currentChannelId };
  }

  async next(context: CommandContext): Promise<AmbientCommandResult> {
    return this.idempotent(context.requestId, JSON.stringify(["next"]), () => {
      const channel = this.requireCurrentChannel();
      this.sceneIndex = (this.sceneIndex + 1) % channel.sceneTitles.length;
      this.status.sceneTitle = channel.sceneTitles[this.sceneIndex] ?? null;
      this.status.explanation = "The user advanced to the next scene in the active channel.";
      return this.apply(context.requestId, `Advanced to ${this.status.sceneTitle}.`, false);
    });
  }

  async activateChannel(input: {
    channelId: string;
    displayScope: DisplayScope;
    durationMinutes?: number;
    requestId: string;
  }): Promise<AmbientCommandResult> {
    return this.idempotent(
      input.requestId,
      JSON.stringify(["activate", input.channelId, input.displayScope, input.durationMinutes ?? null]),
      () => {
      const channel = CHANNELS.find((candidate) => candidate.id === input.channelId);
      if (!channel) {
        throw new AmbientAdapterError(`Channel '${input.channelId}' was not found.`, "not_found");
      }
      this.sceneIndex = 0;
      this.status.currentChannelId = channel.id;
      this.status.currentChannelName = channel.name;
      this.status.sceneTitle = channel.sceneTitles[0] ?? null;
      this.status.winningRule = "Manual activation";
      this.status.explanation = input.durationMinutes
        ? `${channel.name} was activated on ${input.displayScope} display scope for ${input.durationMinutes} minutes.`
        : `${channel.name} was activated on ${input.displayScope} display scope.`;
      this.status.paused = false;
        return this.apply(input.requestId, this.status.explanation, false);
      },
    );
  }

  async pause(input: { durationMinutes?: number; requestId: string }): Promise<AmbientCommandResult> {
    return this.idempotent(input.requestId, JSON.stringify(["pause", input.durationMinutes ?? null]), () => {
      this.status.paused = true;
      const message = input.durationMinutes
        ? `Ambient is paused for ${input.durationMinutes} minutes.`
        : "Ambient is paused until resumed.";
      return this.apply(input.requestId, message, false);
    });
  }

  async resume(context: CommandContext): Promise<AmbientCommandResult> {
    return this.idempotent(context.requestId, JSON.stringify(["resume"]), () => {
      this.status.paused = false;
      return this.apply(context.requestId, "Ambient resumed its existing rules.", false);
    });
  }

  async setPowerPolicy(input: { policy: PowerPolicy; requestId: string }): Promise<AmbientCommandResult> {
    return this.idempotent(input.requestId, JSON.stringify(["power_policy", input.policy]), () => {
      this.status.powerPolicy = input.policy;
      this.status.renderer = input.policy === "still" ? "still" : input.policy === "always_live" ? "aerial" : this.status.renderer;
      return this.apply(input.requestId, `Power policy changed to ${input.policy}.`, false);
    });
  }

  async getHistory(limit: number): Promise<AmbientHistoryItem[]> {
    return clone(this.history.slice(0, limit));
  }

  async restorePrevious(context: CommandContext): Promise<AmbientCommandResult> {
    return this.idempotent(context.requestId, JSON.stringify(["restore"]), () => {
      this.status.currentChannelId = null;
      this.status.currentChannelName = null;
      this.status.sceneTitle = null;
      this.status.winningRule = null;
      this.status.paused = true;
      this.status.explanation = "Restored the wallpapers that were active before Project Ambient.";
      return this.apply(context.requestId, this.status.explanation, false);
    });
  }

  private requireCurrentChannel(): AmbientChannel {
    const channel = CHANNELS.find((candidate) => candidate.id === this.status.currentChannelId);
    if (!channel) {
      throw new AmbientAdapterError("No active channel is available.", "not_available");
    }
    return channel;
  }

  private idempotent(
    requestId: string,
    fingerprint: string,
    execute: () => AmbientCommandResult,
  ): AmbientCommandResult {
    const previous = this.commands.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new AmbientAdapterError(
          "This request ID was already used for a different Ambient command.",
          "command_failed",
        );
      }
      return { ...clone(previous.result), status: "already_applied" };
    }
    const result = execute();
    this.commands.set(requestId, { fingerprint, result: clone(result) });
    if (this.commands.size > DemoAmbientAdapter.maximumCompletedEntries) {
      const oldest = this.commands.keys().next().value;
      if (oldest !== undefined) this.commands.delete(oldest);
    }
    return result;
  }

  private apply(requestId: string, message: string, undoAvailable = false): AmbientCommandResult {
    const appliedAt = this.now().toISOString();
    this.status.appliedAt = appliedAt;
    return {
      commandId: commandId(requestId),
      status: "applied",
      message,
      requestId,
      effectiveChannelId: this.status.currentChannelId,
      effectivePowerPolicy: this.status.powerPolicy,
      paused: this.status.paused,
      undoAvailable,
      appliedAt,
    };
  }
}
