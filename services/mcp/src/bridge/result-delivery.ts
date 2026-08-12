import {
  BRIDGE_MAX_RETRY_AFTER_MS,
  BRIDGE_RESULT_DEADLINE_RESERVE_MS,
  BRIDGE_RESULT_HTTP_TIMEOUT_MS,
} from "./types.js";

export function retryAfterMilliseconds(response: Response, now = Date.now()): number {
  if (response.status !== 429) return 0;
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.min(Math.max(delay, 0), BRIDGE_MAX_RETRY_AFTER_MS) : 0;
}

export interface PendingBridgeResult {
  commandId: string;
  leaseId: string;
  leaseExpiresAt: string;
  expiresAt: string;
  body: Record<string, unknown>;
}

export async function deliverPendingBridgeResult(
  pending: PendingBridgeResult,
  options: {
    url: string;
    headers: Record<string, string>;
    fetch: typeof fetch;
    now: () => number;
    sleep: (milliseconds: number) => Promise<void>;
    baseRetryMs: number;
    assertProtocol: (response: Response) => void;
    timeoutSignal?: (milliseconds: number) => AbortSignal;
  },
): Promise<void> {
  const payload = JSON.stringify({ ...pending.body, lease_id: pending.leaseId });
  const deadline = Math.min(Date.parse(pending.leaseExpiresAt), Date.parse(pending.expiresAt));
  let failures = 0;
  while (options.now() + BRIDGE_RESULT_DEADLINE_RESERVE_MS < deadline) {
    const requestTimeoutMs = Math.min(
      BRIDGE_RESULT_HTTP_TIMEOUT_MS,
      deadline - options.now() - BRIDGE_RESULT_DEADLINE_RESERVE_MS,
    );
    if (requestTimeoutMs <= 0) break;
    let response: Response;
    try {
      response = await options.fetch(
        `${options.url}/bridge/v1/agent/commands/${encodeURIComponent(pending.commandId)}/result`,
        {
          method: "POST",
          headers: { ...options.headers, "content-type": "application/json" },
          body: payload,
          signal: (options.timeoutSignal ?? AbortSignal.timeout)(requestTimeoutMs),
        },
      );
    } catch (error) {
      failures += 1;
      const delayMs = Math.min(
        options.baseRetryMs * (2 ** Math.min(failures - 1, 5)),
        BRIDGE_RESULT_HTTP_TIMEOUT_MS,
      );
      if (options.now() + delayMs >= deadline) throw error;
      await options.sleep(delayMs);
      continue;
    }
    if (response.ok) {
      options.assertProtocol(response);
      return;
    }
    if (response.status === 409) throw new Error("Bridge lease is no longer usable.");
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Bridge rejected result with HTTP ${response.status}.`);
    }
    failures += 1;
    const exponentialMs = Math.min(
      options.baseRetryMs * (2 ** Math.min(failures - 1, 5)),
      BRIDGE_RESULT_HTTP_TIMEOUT_MS,
    );
    const delayMs = Math.max(exponentialMs, retryAfterMilliseconds(response, options.now()));
    if (options.now() + delayMs >= deadline) {
      throw new Error("Bridge result could not be acknowledged before its lease expired.");
    }
    await options.sleep(delayMs);
  }
  throw new Error("Bridge result lease expired before acknowledgement.");
}
