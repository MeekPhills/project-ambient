// These are the three power modes the native macOS engine can enforce. Keep
// the public contract narrower than the UI copy: there is no separate native
// "live only on AC" mode, so advertising one would promise behavior the
// companion cannot deliver.
export const POWER_POLICIES = ["still", "adaptive", "always_live"] as const;
export type PowerPolicy = (typeof POWER_POLICIES)[number];

export const DISPLAY_SCOPES = ["all", "primary"] as const;
export type DisplayScope = (typeof DISPLAY_SCOPES)[number];

export type Renderer = "still" | "aerial" | "native_live";

export interface AmbientStatus {
  deviceId: string;
  displayName: string;
  appVersion: string;
  online: boolean;
  paused: boolean;
  currentChannelId: string | null;
  currentChannelName: string | null;
  sceneTitle: string | null;
  winningRule: string | null;
  explanation: string;
  powerPolicy: PowerPolicy;
  renderer: Renderer;
  appliedAt: string | null;
}

export interface AmbientChannelSummary {
  id: string;
  name: string;
  description: string;
  mediaCount: number;
  rendererCompatibility: Renderer[];
  rightsStatus: "user_owned" | "licensed" | "unknown";
  active: boolean;
}

export interface AmbientChannel extends AmbientChannelSummary {
  tags: string[];
  rules: string[];
  powerPolicy: PowerPolicy;
  sceneTitles: string[];
}

export interface AmbientHistoryItem {
  id: string;
  position: number;
  sceneTitle: string;
  mediaKind: "image" | "video";
}

export interface AmbientCommandResult {
  commandId: string;
  status: "applied" | "already_applied" | "scheduled";
  message: string;
  requestId: string;
  effectiveChannelId: string | null;
  effectivePowerPolicy: PowerPolicy;
  paused: boolean;
  undoAvailable: boolean;
  appliedAt: string;
}

export interface CommandContext {
  requestId: string;
}

export interface AmbientAdapter {
  getStatus(): Promise<AmbientStatus>;
  listChannels(): Promise<AmbientChannelSummary[]>;
  getChannel(channelId: string): Promise<AmbientChannel>;
  next(context: CommandContext): Promise<AmbientCommandResult>;
  activateChannel(input: {
    channelId: string;
    displayScope: DisplayScope;
    durationMinutes?: number;
    requestId: string;
  }): Promise<AmbientCommandResult>;
  pause(input: { durationMinutes?: number; requestId: string }): Promise<AmbientCommandResult>;
  resume(context: CommandContext): Promise<AmbientCommandResult>;
  setPowerPolicy(input: { policy: PowerPolicy; requestId: string }): Promise<AmbientCommandResult>;
  getHistory(limit: number): Promise<AmbientHistoryItem[]>;
  restorePrevious(context: CommandContext): Promise<AmbientCommandResult>;
}

export class AmbientAdapterError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "not_available"
      | "invalid_response"
      | "timeout"
      | "command_failed",
  ) {
    super(message);
    this.name = "AmbientAdapterError";
  }
}
