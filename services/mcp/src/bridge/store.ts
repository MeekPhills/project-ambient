import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  BridgeCommand,
  BridgeDevice,
  BridgeOperation,
  BridgeState,
  BridgeStore,
} from "./types.js";
import {
  BRIDGE_DEFAULT_MAX_ATTEMPTS,
  BRIDGE_LEGACY_LEASE_ERROR,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_REQUEST_ID_CONFLICT_ERROR,
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
  BridgeSchemaMigrationError,
  bridgeOperationSchema,
  hashToken,
  newCommandId,
  newDeviceIdentity,
  newLeaseId,
  operationRequestId,
} from "./types.js";

const EMPTY_STATE: BridgeState = { schemaVersion: 3, devices: [], commands: [] };
const MUTATION_OPERATION_TYPES = new Set([
  "next",
  "activate_channel",
  "pause",
  "resume",
  "set_power_policy",
  "restore_previous",
]);

function safeHashEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function jsonRequestId(value: unknown): { value: string | null; invalid: boolean } {
  if (value === undefined || value === null) return { value: null, invalid: false };
  if (typeof value !== "string") return { value: null, invalid: true };
  const normalized = value.trim();
  return {
    value: normalized.length >= 16 && normalized.length <= 128 ? normalized : null,
    invalid: normalized.length < 16 || normalized.length > 128,
  };
}

function migrateJsonState(value: unknown): BridgeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeSchemaMigrationError("The JSON bridge state must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== undefined
    && (!Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 1)
  ) {
    throw new BridgeSchemaMigrationError("The JSON bridge state has an invalid schema version.");
  }
  const legacy = raw.schemaVersion === undefined || (raw.schemaVersion as number) < 3;
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > 3) {
    throw new BridgeSchemaMigrationError(
      `JSON bridge schema version ${raw.schemaVersion} is newer than supported version 3.`,
    );
  }
  if (!Array.isArray(raw.devices) || !Array.isArray(raw.commands)) {
    throw new BridgeSchemaMigrationError("The JSON bridge state must contain device and command arrays.");
  }
  const devices = raw.devices as BridgeDevice[];
  const deviceIds = new Set<string>();
  for (const device of devices) {
    if (
      !device
      || typeof device !== "object"
      || typeof device.deviceId !== "string"
      || typeof device.displayName !== "string"
      || typeof device.tokenHash !== "string"
      || typeof device.enrolledAt !== "string"
      || !Number.isFinite(Date.parse(device.enrolledAt))
      || (device.lastSeenAt !== null
        && (typeof device.lastSeenAt !== "string" || !Number.isFinite(Date.parse(device.lastSeenAt))))
      || (device.revokedAt !== null
        && (typeof device.revokedAt !== "string" || !Number.isFinite(Date.parse(device.revokedAt))))
    ) {
      throw new BridgeSchemaMigrationError("The JSON bridge state contains an invalid device.");
    }
    deviceIds.add(device.deviceId);
  }

  const commands = raw.commands.map((entry): BridgeCommand => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BridgeSchemaMigrationError("The JSON bridge state contains an invalid command.");
    }
    const command = entry as Record<string, unknown>;
    if (
      typeof command.id !== "string"
      || typeof command.deviceId !== "string"
      || !deviceIds.has(command.deviceId)
      || typeof command.status !== "string"
      || !["pending", "leased", "succeeded", "failed", "expired"].includes(command.status)
      || typeof command.createdAt !== "string"
      || !Number.isFinite(Date.parse(command.createdAt))
      || typeof command.expiresAt !== "string"
      || !Number.isFinite(Date.parse(command.expiresAt))
      || !command.operation
      || typeof command.operation !== "object"
      || Array.isArray(command.operation)
    ) {
      throw new BridgeSchemaMigrationError(`JSON bridge command ${String(command.id)} is malformed.`);
    }

    const rawOperation = command.operation as Record<string, unknown>;
    const operationHasRequestId = Object.hasOwn(rawOperation, "requestId");
    const operationCandidate = jsonRequestId(rawOperation.requestId);
    const columnCandidate = jsonRequestId(command.requestId);
    const mutationOperation = MUTATION_OPERATION_TYPES.has(String(rawOperation.type));
    const mutationMissingRequestId = mutationOperation
      && !operationHasRequestId
      && columnCandidate.value === null;
    const readHasRequestId = !mutationOperation
      && (operationHasRequestId || columnCandidate.value !== null);
    const invalid = operationCandidate.invalid
      || columnCandidate.invalid
      || mutationMissingRequestId
      || readHasRequestId;
    const disagrees = !invalid
      && operationHasRequestId
      && operationCandidate.value !== columnCandidate.value
      && columnCandidate.value !== null;
    if (
      !legacy
      && (command.status === "pending" || command.status === "leased")
      && (
        invalid
        || operationCandidate.value !== columnCandidate.value
        || (mutationOperation && columnCandidate.value === null)
        || (!mutationOperation && columnCandidate.value !== null)
      )
    ) {
      throw new BridgeSchemaMigrationError(
        `JSON bridge command ${command.id} has an inconsistent request identifier.`,
      );
    }
    const requestIdIssue = invalid || disagrees;
    const operationInput = !operationHasRequestId && columnCandidate.value !== null
      ? { ...rawOperation, requestId: columnCandidate.value }
      : rawOperation;
    const parsedOperation = bridgeOperationSchema.safeParse(operationInput);
    let operation: BridgeOperation;
    if (parsedOperation.success) {
      operation = parsedOperation.data;
    } else if (requestIdIssue) {
      const requestIdRepaired = bridgeOperationSchema.safeParse({
        ...rawOperation,
        requestId: "legacy-invalid-request-0001",
      });
      if (!requestIdRepaired.success) {
        throw new BridgeSchemaMigrationError(`JSON bridge command ${command.id} has an invalid operation.`);
      }
      operation = rawOperation as BridgeOperation;
    } else {
      throw new BridgeSchemaMigrationError(`JSON bridge command ${command.id} has an invalid operation.`);
    }

    const explicitAttemptCount = command.attemptCount;
    const explicitMaxAttempts = command.maxAttempts;
    const attemptCount = explicitAttemptCount === undefined ? 0 : explicitAttemptCount;
    const maxAttempts = explicitMaxAttempts === undefined ? BRIDGE_DEFAULT_MAX_ATTEMPTS : explicitMaxAttempts;
    if (
      !Number.isInteger(attemptCount)
      || !Number.isInteger(maxAttempts)
      || (attemptCount as number) < 0
      || (maxAttempts as number) < 1
      || (maxAttempts as number) > 10
      || (attemptCount as number) > (maxAttempts as number)
    ) {
      throw new BridgeSchemaMigrationError(`JSON bridge command ${command.id} has invalid attempt controls.`);
    }
    if (!legacy && command.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new BridgeSchemaMigrationError(`JSON bridge command ${command.id} has an invalid protocol version.`);
    }

    let status = command.status as BridgeCommand["status"];
    let error = typeof command.error === "string" ? command.error : null;
    let result = command.result ?? null;
    let leaseId = typeof command.leaseId === "string" ? command.leaseId : null;
    let leaseExpiresAt = typeof command.leaseExpiresAt === "string" ? command.leaseExpiresAt : null;
    if (status === "leased" && legacy) {
      status = "failed";
      error = BRIDGE_LEGACY_LEASE_ERROR;
      result = null;
      leaseId = null;
      leaseExpiresAt = null;
    } else if (status === "leased") {
      if (!leaseId || !leaseExpiresAt || !Number.isFinite(Date.parse(leaseExpiresAt))) {
        throw new BridgeSchemaMigrationError(`JSON bridge command ${command.id} has an invalid lease.`);
      }
    } else if (status === "pending" && requestIdIssue) {
      status = "failed";
      error = disagrees
        ? BRIDGE_REQUEST_ID_CONFLICT_ERROR
        : "Command was failed during upgrade because its request identifier was invalid.";
      leaseId = null;
      leaseExpiresAt = null;
    } else {
      if (
        !legacy
        && (status === "pending" || status === "expired")
        && command.leaseId !== null
      ) {
        throw new BridgeSchemaMigrationError(`JSON bridge command ${command.id} has an invalid lease shape.`);
      }
      if (status === "pending" || status === "expired") leaseId = null;
      leaseExpiresAt = null;
    }

    return {
      id: command.id,
      deviceId: command.deviceId,
      operation,
      status,
      createdAt: command.createdAt,
      expiresAt: command.expiresAt,
      leaseExpiresAt,
      leaseId,
      requestId: legacy
        ? (requestIdIssue ? null : (operationCandidate.value ?? columnCandidate.value))
        : columnCandidate.value,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      attemptCount: attemptCount as number,
      maxAttempts: maxAttempts as number,
      result,
      error,
    };
  });

  const statusRank: Record<BridgeCommand["status"], number> = {
    succeeded: 0,
    failed: 1,
    pending: 2,
    expired: 3,
    leased: 4,
  };
  const duplicates = new Map<string, BridgeCommand[]>();
  for (const command of commands) {
    if (!command.requestId) continue;
    const key = JSON.stringify([command.deviceId, command.requestId]);
    const group = duplicates.get(key) ?? [];
    group.push(command);
    duplicates.set(key, group);
  }
  for (const group of duplicates.values()) {
    group.sort((left, right) => statusRank[left.status] - statusRank[right.status]
      || Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.id.localeCompare(right.id));
    for (const duplicate of group.slice(1)) {
      duplicate.requestId = null;
      if (duplicate.status === "pending") {
        duplicate.status = "failed";
        duplicate.error =
          "Command was failed during upgrade because its request identifier duplicated an earlier command.";
        duplicate.leaseExpiresAt = null;
        duplicate.leaseId = null;
      }
    }
  }

  return { schemaVersion: 3, devices: clone(devices), commands };
}

export abstract class BaseBridgeStore implements BridgeStore {
  private queue = Promise.resolve();

  protected constructor(private readonly now: () => Date = () => new Date()) {}

  protected abstract readState(): Promise<BridgeState>;
  protected abstract writeState(state: BridgeState): Promise<void>;

  async initialize(): Promise<void> {}

  protected transaction<T>(change: (state: BridgeState) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const state = await this.readState();
      const result = await change(state);
      await this.writeState(state);
      return result;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async createDevice(displayName: string): Promise<{ device: BridgeDevice; token: string }> {
    return this.transaction((state) => {
      const { deviceId, token } = newDeviceIdentity();
      const device: BridgeDevice = {
        deviceId,
        displayName,
        tokenHash: hashToken(token),
        enrolledAt: this.now().toISOString(),
        lastSeenAt: null,
        revokedAt: null,
      };
      state.devices.push(device);
      return { device: clone(device), token };
    });
  }

  async getDevice(deviceId: string): Promise<BridgeDevice | null> {
    const state = await this.readState();
    return clone(state.devices.find((device) => device.deviceId === deviceId) ?? null);
  }

  async authenticateDevice(deviceId: string, token: string): Promise<BridgeDevice | null> {
    const state = await this.readState();
    const device = state.devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || device.revokedAt || !safeHashEqual(hashToken(token), device.tokenHash)) return null;
    return clone(device);
  }

  async touchDevice(deviceId: string, at: string): Promise<void> {
    await this.transaction((state) => {
      const device = state.devices.find((candidate) => candidate.deviceId === deviceId);
      if (device) device.lastSeenAt = at;
    });
  }

  async revokeDevice(deviceId: string, at: string): Promise<boolean> {
    return this.transaction((state) => {
      const device = state.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt) return false;
      device.revokedAt = at;
      for (const command of state.commands) {
        if (command.deviceId === deviceId && (command.status === "pending" || command.status === "leased")) {
          command.status = "failed";
          command.error = "Device revoked before command completed.";
          command.result = null;
          command.leaseExpiresAt = null;
          command.leaseId = null;
        }
      }
      return true;
    });
  }

  async enqueue(deviceId: string, operation: BridgeOperation, ttlSeconds: number): Promise<BridgeCommand> {
    return this.transaction((state) => {
      const device = state.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt) throw new BridgeDeviceUnavailableError();
      const now = this.now();
      const normalizedOperation = bridgeOperationSchema.parse(operation);
      const requestId = operationRequestId(normalizedOperation);
      if (requestId) {
        const existing = state.commands.find(
          (candidate) => candidate.deviceId === deviceId
            && candidate.requestId === requestId,
        );
        if (existing) {
          if (!isDeepStrictEqual(existing.operation, normalizedOperation)) throw new BridgeRequestConflictError();
          if (
            existing.status === "expired"
            || ((existing.status === "pending" || existing.status === "leased")
              && new Date(existing.expiresAt) <= now)
          ) {
            existing.status = "pending";
            existing.expiresAt = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
            existing.leaseExpiresAt = null;
            existing.leaseId = null;
            existing.attemptCount = 0;
            existing.result = null;
            existing.error = null;
          }
          return clone(existing);
        }
      }
      const command: BridgeCommand = {
        id: newCommandId(),
        deviceId,
        operation: clone(normalizedOperation),
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
        leaseExpiresAt: null,
        leaseId: null,
        requestId,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        attemptCount: 0,
        maxAttempts: BRIDGE_DEFAULT_MAX_ATTEMPTS,
        result: null,
        error: null,
      };
      state.commands.push(command);
      return clone(command);
    });
  }

  async leaseNext(deviceId: string, leaseSeconds: number): Promise<BridgeCommand | null> {
    return this.transaction((state) => {
      const device = state.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt) return null;
      const now = this.now();
      const leaseDeadline = new Date(now.getTime() + leaseSeconds * 1_000);
      for (const command of state.commands) {
        if (
          (command.status === "pending" || command.status === "leased")
          && new Date(command.expiresAt) <= now
        ) {
          command.status = "expired";
          command.leaseExpiresAt = null;
          command.leaseId = null;
        }
        if (command.status === "leased" && command.leaseExpiresAt && new Date(command.leaseExpiresAt) <= now) {
          command.status = command.attemptCount >= command.maxAttempts ? "failed" : "pending";
          command.error = command.status === "failed"
            ? `Command delivery failed after ${command.maxAttempts} lease attempts.`
            : null;
          command.leaseExpiresAt = null;
          command.leaseId = null;
        }
        if (command.status === "pending" && new Date(command.expiresAt) <= leaseDeadline) {
          command.status = "expired";
          command.leaseExpiresAt = null;
          command.leaseId = null;
        }
      }
      const command = state.commands.find(
        (candidate) => candidate.deviceId === deviceId
          && candidate.status === "pending"
          && candidate.attemptCount < candidate.maxAttempts,
      );
      if (!command) return null;
      command.status = "leased";
      command.leaseExpiresAt = leaseDeadline.toISOString();
      command.leaseId = newLeaseId();
      command.attemptCount += 1;
      return clone(command);
    });
  }

  async complete(commandId: string, deviceId: string, leaseId: string, result: unknown): Promise<BridgeCommand | null> {
    return this.finish(commandId, deviceId, leaseId, "succeeded", result, null);
  }

  async fail(commandId: string, deviceId: string, leaseId: string, error: string): Promise<BridgeCommand | null> {
    return this.finish(commandId, deviceId, leaseId, "failed", null, error);
  }

  private async finish(
    commandId: string,
    deviceId: string,
    leaseId: string,
    status: "succeeded" | "failed",
    result: unknown,
    error: string | null,
  ): Promise<BridgeCommand | null> {
    return this.transaction((state) => {
      const command = state.commands.find(
        (candidate) => candidate.id === commandId && candidate.deviceId === deviceId,
      );
      if (!command || command.leaseId !== leaseId) return null;
      if (command.status === status) return clone(command);
      if (command.status !== "leased") return null;
      const device = state.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt) return null;
      const now = this.now();
      if (new Date(command.expiresAt) <= now) {
        command.status = "expired";
        command.leaseExpiresAt = null;
        command.leaseId = null;
        return null;
      }
      if (!command.leaseExpiresAt || new Date(command.leaseExpiresAt) <= now) {
        command.status = command.attemptCount >= command.maxAttempts ? "failed" : "pending";
        command.error = command.status === "failed"
          ? `Command delivery failed after ${command.maxAttempts} lease attempts.`
          : null;
        command.leaseExpiresAt = null;
        command.leaseId = null;
        return null;
      }
      command.status = status;
      command.result = clone(result);
      command.error = error;
      command.leaseExpiresAt = null;
      return clone(command);
    });
  }

  async getCommand(commandId: string): Promise<BridgeCommand | null> {
    return this.transaction((state) => {
      const command = state.commands.find((candidate) => candidate.id === commandId);
      if (!command) return null;
      if (
        (command.status === "pending" || command.status === "leased")
        && new Date(command.expiresAt) <= this.now()
      ) {
        command.status = "expired";
        command.leaseExpiresAt = null;
        command.leaseId = null;
      }
      return clone(command);
    });
  }
}

export class MemoryBridgeStore extends BaseBridgeStore {
  private state: BridgeState = clone(EMPTY_STATE);

  constructor(now?: () => Date) {
    super(now);
  }

  protected async readState(): Promise<BridgeState> {
    return clone(this.state);
  }

  protected async writeState(state: BridgeState): Promise<void> {
    this.state = clone(state);
  }
}

export class JsonFileBridgeStore extends BaseBridgeStore {
  private initialization: Promise<void> | undefined;

  constructor(private readonly path: string, now?: () => Date) {
    super(now);
  }

  protected async readState(): Promise<BridgeState> {
    try {
      return migrateJsonState(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return clone(EMPTY_STATE);
      }
      throw error;
    }
  }

  protected async writeState(state: BridgeState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.path);
  }

  override initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.transaction(() => undefined);
    }
    return this.initialization;
  }
}
