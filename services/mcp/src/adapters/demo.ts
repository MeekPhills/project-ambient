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
    powerPolicy: "live_on_ac",
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
  private status: AmbientStatus;
  private readonly history: AmbientHistoryItem[];
  private readonly commands = new Map<string, AmbientCommandResult>();
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
        id: "history_003",
        action: "activate",
        occurredAt: "2026-08-12T12:00:00.000Z",
        channelId: "beaches",
        channelName: "Beaches",
        sceneTitle: "Cape May Sunrise",
        explanation: "Morning calm rule selected Beaches.",
        restorable: true,
      },
      {
        id: "history_002",
        action: "next",
        occurredAt: "2026-08-11T22:15:00.000Z",
        channelId: "philadelphia-sports",
        channelName: "Philadelphia Sports",
        sceneTitle: "Ballpark Lights",
        explanation: "User advanced to the next scene.",
        restorable: true,
      },
      {
        id: "history_001",
        action: "power_policy",
        occurredAt: "2026-08-11T18:00:00.000Z",
        channelId: "quiet-nature",
        channelName: "Quiet Nature",
        sceneTitle: "Misty Pines",
        explanation: "Adaptive power policy was enabled.",
        restorable: false,
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
    return this.idempotent(context.requestId, () => {
      const channel = this.requireCurrentChannel();
      this.sceneIndex = (this.sceneIndex + 1) % channel.sceneTitles.length;
      this.status.sceneTitle = channel.sceneTitles[this.sceneIndex] ?? null;
      this.status.explanation = "The user advanced to the next scene in the active channel.";
      return this.apply("next", context.requestId, `Advanced to ${this.status.sceneTitle}.`);
    });
  }

  async activateChannel(input: {
    channelId: string;
    displayScope: DisplayScope;
    durationMinutes?: number;
    requestId: string;
  }): Promise<AmbientCommandResult> {
    return this.idempotent(input.requestId, () => {
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
      return this.apply("activate", input.requestId, this.status.explanation);
    });
  }

  async pause(input: { durationMinutes?: number; requestId: string }): Promise<AmbientCommandResult> {
    return this.idempotent(input.requestId, () => {
      this.status.paused = true;
      const message = input.durationMinutes
        ? `Ambient is paused for ${input.durationMinutes} minutes.`
        : "Ambient is paused until resumed.";
      return this.apply("pause", input.requestId, message);
    });
  }

  async resume(context: CommandContext): Promise<AmbientCommandResult> {
    return this.idempotent(context.requestId, () => {
      this.status.paused = false;
      return this.apply("resume", context.requestId, "Ambient resumed its existing rules.");
    });
  }

  async setPowerPolicy(input: { policy: PowerPolicy; requestId: string }): Promise<AmbientCommandResult> {
    return this.idempotent(input.requestId, () => {
      this.status.powerPolicy = input.policy;
      this.status.renderer = input.policy === "still" ? "still" : input.policy === "always_live" ? "aerial" : this.status.renderer;
      return this.apply("power_policy", input.requestId, `Power policy changed to ${input.policy}.`);
    });
  }

  async getHistory(limit: number): Promise<AmbientHistoryItem[]> {
    return clone(this.history.slice(0, limit));
  }

  async restorePrevious(context: CommandContext): Promise<AmbientCommandResult> {
    return this.idempotent(context.requestId, () => {
      const previous = this.history.find((item) => item.restorable && item.channelId !== this.status.currentChannelId);
      if (!previous?.channelId) {
        throw new AmbientAdapterError("There is no restorable previous scene.", "not_available");
      }
      const channel = CHANNELS.find((candidate) => candidate.id === previous.channelId);
      if (!channel) {
        throw new AmbientAdapterError("The previous channel is no longer available.", "not_available");
      }
      this.status.currentChannelId = channel.id;
      this.status.currentChannelName = channel.name;
      this.status.sceneTitle = previous.sceneTitle;
      this.status.winningRule = "History restore";
      this.status.explanation = "The previous restorable scene was restored from local history.";
      return this.apply("restore", context.requestId, `Restored ${previous.sceneTitle ?? channel.name}.`);
    });
  }

  private requireCurrentChannel(): AmbientChannel {
    const channel = CHANNELS.find((candidate) => candidate.id === this.status.currentChannelId);
    if (!channel) {
      throw new AmbientAdapterError("No active channel is available.", "not_available");
    }
    return channel;
  }

  private idempotent(requestId: string, execute: () => AmbientCommandResult): AmbientCommandResult {
    const previous = this.commands.get(requestId);
    if (previous) {
      return { ...clone(previous), status: "already_applied" };
    }
    const result = execute();
    this.commands.set(requestId, clone(result));
    return result;
  }

  private apply(action: AmbientHistoryItem["action"], requestId: string, message: string): AmbientCommandResult {
    const appliedAt = this.now().toISOString();
    this.status.appliedAt = appliedAt;
    this.history.unshift({
      id: `history_${commandId(requestId).slice(4)}`,
      action,
      occurredAt: appliedAt,
      channelId: this.status.currentChannelId,
      channelName: this.status.currentChannelName,
      sceneTitle: this.status.sceneTitle,
      explanation: message,
      restorable: action !== "power_policy" && action !== "pause" && action !== "resume",
    });
    return {
      commandId: commandId(requestId),
      status: "applied",
      message,
      requestId,
      effectiveChannelId: this.status.currentChannelId,
      effectivePowerPolicy: this.status.powerPolicy,
      paused: this.status.paused,
      undoAvailable: this.history.some((item) => item.restorable),
      appliedAt,
    };
  }
}
