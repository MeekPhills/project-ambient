import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as z from "zod/v4";

const requestIdSchema = z.string().trim().min(16).max(128);

export const bridgeOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("get_status") }),
  z.object({ type: z.literal("list_channels") }),
  z.object({ type: z.literal("get_channel"), channelId: z.string().min(1).max(128) }),
  z.object({ type: z.literal("next"), requestId: requestIdSchema }),
  z.object({
    type: z.literal("activate_channel"),
    channelId: z.string().min(1).max(128),
    displayScope: z.enum(["all", "primary"]),
    durationMinutes: z.number().int().min(1).max(1_440).optional(),
    requestId: requestIdSchema,
  }),
  z.object({
    type: z.literal("pause"),
    durationMinutes: z.number().int().min(1).max(1_440).optional(),
    requestId: requestIdSchema,
  }),
  z.object({ type: z.literal("resume"), requestId: requestIdSchema }),
  z.object({
    type: z.literal("set_power_policy"),
    policy: z.enum(["still", "adaptive", "always_live"]),
    requestId: requestIdSchema,
  }),
  z.object({ type: z.literal("get_history"), limit: z.number().int().min(1).max(50) }),
  z.object({ type: z.literal("restore_previous"), requestId: requestIdSchema }),
]);

export type BridgeOperation = z.infer<typeof bridgeOperationSchema>;

export interface BridgeDevice {
  deviceId: string;
  displayName: string;
  tokenHash: string;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface BridgeCommand {
  id: string;
  deviceId: string;
  operation: BridgeOperation;
  status: "pending" | "leased" | "succeeded" | "failed" | "expired";
  createdAt: string;
  expiresAt: string;
  leaseExpiresAt: string | null;
  leaseId: string | null;
  requestId: string | null;
  protocolVersion: 2;
  attemptCount: number;
  maxAttempts: number;
  result: unknown | null;
  error: string | null;
}

export interface BridgeState {
  schemaVersion?: number;
  devices: BridgeDevice[];
  commands: BridgeCommand[];
}

export interface BridgeStore {
  initialize(): Promise<void>;
  createDevice(displayName: string): Promise<{ device: BridgeDevice; token: string }>;
  getDevice(deviceId: string): Promise<BridgeDevice | null>;
  authenticateDevice(deviceId: string, token: string): Promise<BridgeDevice | null>;
  touchDevice(deviceId: string, at: string): Promise<void>;
  revokeDevice(deviceId: string, at: string): Promise<boolean>;
  enqueue(deviceId: string, operation: BridgeOperation, ttlSeconds: number): Promise<BridgeCommand>;
  leaseNext(deviceId: string, leaseSeconds: number): Promise<BridgeCommand | null>;
  complete(commandId: string, deviceId: string, leaseId: string, result: unknown): Promise<BridgeCommand | null>;
  fail(commandId: string, deviceId: string, leaseId: string, error: string): Promise<BridgeCommand | null>;
  getCommand(commandId: string): Promise<BridgeCommand | null>;
}

export class BridgeDeviceUnavailableError extends Error {
  constructor() {
    super("The bridge device is not available.");
    this.name = "BridgeDeviceUnavailableError";
  }
}

export class BridgeRequestConflictError extends Error {
  constructor() {
    super("The request ID is already associated with a different operation.");
    this.name = "BridgeRequestConflictError";
  }
}

export class BridgeSchemaMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BridgeSchemaMigrationError";
  }
}

export const BRIDGE_PROTOCOL_VERSION = 2 as const;
export const BRIDGE_REQUIRED_CAPABILITY = "lease_id" as const;
export const BRIDGE_DEFAULT_MAX_ATTEMPTS = 3;
export const BRIDGE_LEGACY_LEASE_ERROR =
  "Command was failed during the bridge protocol v2 upgrade; it was not replayed.";
export const BRIDGE_REQUEST_ID_CONFLICT_ERROR =
  "Command was failed during upgrade because stored request identifiers disagreed.";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newDeviceIdentity() {
  return {
    deviceId: `device_${randomUUID()}`,
    token: `amb_dev_${randomBytes(32).toString("base64url")}`,
  };
}

export function newCommandId(): string {
  return `bridge_${randomUUID()}`;
}

export function newLeaseId(): string {
  return `lease_${randomUUID()}`;
}

export function operationRequestId(operation: BridgeOperation): string | null {
  return "requestId" in operation ? operation.requestId.trim() : null;
}
