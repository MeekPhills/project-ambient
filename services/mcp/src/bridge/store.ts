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
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
  hashToken,
  newCommandId,
  newDeviceIdentity,
  newLeaseId,
  operationRequestId,
} from "./types.js";

const EMPTY_STATE: BridgeState = { devices: [], commands: [] };

function safeHashEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export abstract class BaseBridgeStore implements BridgeStore {
  private queue = Promise.resolve();

  protected constructor(private readonly now: () => Date = () => new Date()) {}

  protected abstract readState(): Promise<BridgeState>;
  protected abstract writeState(state: BridgeState): Promise<void>;

  private transaction<T>(change: (state: BridgeState) => T | Promise<T>): Promise<T> {
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
      const requestId = operationRequestId(operation);
      if (requestId) {
        const existing = state.commands.find(
          (candidate) => candidate.deviceId === deviceId
            && operationRequestId(candidate.operation) === requestId,
        );
        if (existing) {
          if (!isDeepStrictEqual(existing.operation, operation)) throw new BridgeRequestConflictError();
          if (
            existing.status === "expired"
            || ((existing.status === "pending" || existing.status === "leased")
              && new Date(existing.expiresAt) <= now)
          ) {
            existing.status = "pending";
            existing.expiresAt = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
            existing.leaseExpiresAt = null;
            existing.leaseId = null;
            existing.result = null;
            existing.error = null;
          }
          return clone(existing);
        }
      }
      const command: BridgeCommand = {
        id: newCommandId(),
        deviceId,
        operation: clone(operation),
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
        leaseExpiresAt: null,
        leaseId: null,
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
          command.status = "pending";
          command.leaseExpiresAt = null;
          command.leaseId = null;
        }
      }
      const command = state.commands.find(
        (candidate) => candidate.deviceId === deviceId && candidate.status === "pending",
      );
      if (!command) return null;
      command.status = "leased";
      command.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
      command.leaseId = newLeaseId();
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
        command.status = "pending";
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
  constructor(private readonly path: string, now?: () => Date) {
    super(now);
  }

  protected async readState(): Promise<BridgeState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as BridgeState;
      for (const command of state.commands) command.leaseId ??= null;
      return state;
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
}
