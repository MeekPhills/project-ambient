import { createHash } from "node:crypto";
import type { Options, Store } from "express-rate-limit";
import type { BridgeRateLimitScope, BridgeStore } from "./types.js";

export class BridgeRateLimitUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Distributed bridge rate limiting is unavailable.", options);
    this.name = "BridgeRateLimitUnavailableError";
  }
}

export class BridgeRateLimitStore implements Store {
  readonly localKeys = false;

  constructor(
    private readonly bridgeStore: BridgeStore,
    private readonly scope: BridgeRateLimitScope,
  ) {
    if (!bridgeStore.incrementRateLimit
      || !bridgeStore.decrementRateLimit
      || !bridgeStore.resetRateLimit) {
      throw new Error("The bridge store does not support distributed rate limiting.");
    }
  }

  private hash(key: string): string {
    return createHash("sha256").update(key).digest("base64url");
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const windowMs = this.windowMs;
    if (!windowMs) throw new Error("The distributed rate-limit store was not initialized.");
    try {
      return await this.bridgeStore.incrementRateLimit!(this.scope, this.hash(key), windowMs);
    } catch (error) {
      throw new BridgeRateLimitUnavailableError({ cause: error });
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.bridgeStore.decrementRateLimit!(this.scope, this.hash(key));
    } catch (error) {
      throw new BridgeRateLimitUnavailableError({ cause: error });
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.bridgeStore.resetRateLimit!(this.scope, this.hash(key));
    } catch (error) {
      throw new BridgeRateLimitUnavailableError({ cause: error });
    }
  }

  private windowMs = 0;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }
}
