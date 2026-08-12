import { isIP } from "node:net";
import type { ErrorRequestHandler, Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import * as z from "zod/v4";
import type { BridgeRateLimitScope, BridgeStore } from "./types.js";
import {
  BridgeRateLimitStore,
  BridgeRateLimitUnavailableError,
} from "./rate-limit-store.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_REQUIRED_CAPABILITY,
  BRIDGE_DEFAULT_COMMAND_TTL_SECONDS,
  BRIDGE_LEASE_SECONDS,
  BRIDGE_MIN_COMMAND_TTL_SECONDS,
  BridgeDeviceUnavailableError,
  BridgeRequestConflictError,
  bridgeOperationSchema,
} from "./types.js";

function supportsBridgeProtocol(request: Request): boolean {
  const version = request.header("x-ambient-protocol-version");
  const capabilities = request.header("x-ambient-capabilities")
    ?.split(",")
    .map((capability) => capability.trim()) ?? [];
  return version === String(BRIDGE_PROTOCOL_VERSION)
    && capabilities.includes(BRIDGE_REQUIRED_CAPABILITY);
}

function requireBridgeProtocol(request: Request, response: Response): boolean {
  response.setHeader("X-Ambient-Protocol-Version", String(BRIDGE_PROTOCOL_VERSION));
  response.setHeader("X-Ambient-Capabilities", BRIDGE_REQUIRED_CAPABILITY);
  if (supportsBridgeProtocol(request)) return true;
  response.status(426).json({
    error: "bridge_protocol_upgrade_required",
    required_protocol_version: BRIDGE_PROTOCOL_VERSION,
    required_capabilities: [BRIDGE_REQUIRED_CAPABILITY],
  });
  return false;
}

const enrollmentSchema = z.object({ display_name: z.string().min(1).max(80) });
const commandSchema = z.object({
  device_id: z.string().min(1).max(128),
  operation: bridgeOperationSchema,
  ttl_seconds: z.number().int().min(BRIDGE_MIN_COMMAND_TTL_SECONDS).max(300)
    .default(BRIDGE_DEFAULT_COMMAND_TTL_SECONDS),
});
const resultSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  lease_id: z.string().min(1).max(128),
  result: z.unknown().optional(),
  error: z.string().max(500).optional(),
});

export interface BridgeRateLimitOptions {
  ingressWindowMs?: number;
  ingressLimit?: number;
  adminWindowMs?: number;
  adminLimit?: number;
  deviceWindowMs?: number;
  deviceLimit?: number;
  distributed?: boolean;
  vercel?: boolean;
}

function rateLimitResponse(response: Response): void {
  response.setHeader("Cache-Control", "no-store");
  response.status(429).json({ error: "rate_limit_exceeded" });
}

function rateLimitStore(
  store: BridgeStore,
  options: BridgeRateLimitOptions,
  scope: BridgeRateLimitScope,
): Store | undefined {
  if (!options.distributed) return undefined;
  if (!store.distributedRateLimit) {
    throw new Error("Distributed bridge rate limiting requires PostgreSQL.");
  }
  return new BridgeRateLimitStore(store, scope);
}

function vercelClientIp(request: Request): string {
  const raw = request.header("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
  if (!raw || isIP(raw) === 0) return "invalid-vercel-client-ip";
  return ipKeyGenerator(raw);
}

export function createBridgeIngressRateLimiter(
  store: BridgeStore,
  options: BridgeRateLimitOptions = {},
): RequestHandler {
  const distributedStore = rateLimitStore(store, options, "ingress");
  return rateLimit({
    windowMs: options.ingressWindowMs ?? 60_000,
    limit: options.ingressLimit ?? 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "bridge-ingress",
    keyGenerator: options.vercel
      ? vercelClientIp
      : (request) => ipKeyGenerator(request.ip ?? "unavailable-client-ip"),
    ...(distributedStore === undefined ? {} : { store: distributedStore }),
    passOnStoreError: false,
    message: { error: "rate_limit_exceeded" },
    handler: (_request, response) => rateLimitResponse(response),
  });
}

export const bridgeRateLimitErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (!(error instanceof BridgeRateLimitUnavailableError)) {
    next(error);
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(503).json({ error: "rate_limit_unavailable" });
};

function deviceRateLimiter(
  store: BridgeStore,
  options: BridgeRateLimitOptions,
  scope: "poll" | "result",
): RequestHandler {
  const distributedStore = rateLimitStore(store, options, `device-${scope}`);
  return rateLimit({
    windowMs: options.deviceWindowMs ?? 60_000,
    limit: options.deviceLimit ?? 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: `bridge-device-${scope}`,
    keyGenerator: (_request, response) => String(response.locals.deviceId),
    ...(distributedStore === undefined ? {} : { store: distributedStore }),
    passOnStoreError: false,
    message: { error: "rate_limit_exceeded" },
    handler: (_request, response) => rateLimitResponse(response),
  });
}

function adminRateLimiter(
  store: BridgeStore,
  options: BridgeRateLimitOptions,
): RequestHandler {
  const distributedStore = rateLimitStore(store, options, "admin");
  return rateLimit({
    windowMs: options.adminWindowMs ?? 60_000,
    limit: options.adminLimit ?? 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "bridge-admin",
    keyGenerator: () => "authenticated-admin",
    ...(distributedStore === undefined ? {} : { store: distributedStore }),
    passOnStoreError: false,
    message: { error: "rate_limit_exceeded" },
    handler: (_request, response) => rateLimitResponse(response),
  });
}

function deviceCredentials(request: Request): { deviceId: string; token: string } | null {
  const deviceId = request.header("x-ambient-device-id");
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  return deviceId && token ? { deviceId, token } : null;
}

function deviceAuth(store: BridgeStore): RequestHandler {
  return async (request, response, next) => {
    const credentials = deviceCredentials(request);
    if (!credentials || !(await store.authenticateDevice(credentials.deviceId, credentials.token))) {
      response.status(401).json({ error: "invalid_device_credentials" });
      return;
    }
    response.locals.deviceId = credentials.deviceId;
    next();
  };
}

export function createBridgeRouter(
  store: BridgeStore,
  adminAuth: RequestHandler,
  rateLimits: BridgeRateLimitOptions = {},
): Router {
  const router = express.Router();
  const adminRateLimit = adminRateLimiter(store, rateLimits);
  const pollRateLimit = deviceRateLimiter(store, rateLimits, "poll");
  const resultRateLimit = deviceRateLimiter(store, rateLimits, "result");

  router.post("/admin/devices/enroll", adminAuth, adminRateLimit, async (request, response) => {
    const input = enrollmentSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "invalid_request", details: input.error.issues });
      return;
    }
    const { device, token } = await store.createDevice(input.data.display_name);
    response.status(201).json({
      device_id: device.deviceId,
      display_name: device.displayName,
      device_token: token,
      enrolled_at: device.enrolledAt,
      warning: "This token is shown once. Store it in the macOS Keychain.",
    });
  });

  router.post("/admin/devices/:deviceId/revoke", adminAuth, adminRateLimit, async (request, response) => {
    const deviceId = String(request.params.deviceId);
    const revoked = await store.revokeDevice(deviceId, new Date().toISOString());
    if (!revoked) {
      response.status(404).json({ error: "device_not_found_or_already_revoked" });
      return;
    }
    response.json({ status: "revoked", device_id: deviceId });
  });

  router.post("/admin/commands", adminAuth, adminRateLimit, async (request, response) => {
    const input = commandSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "invalid_request", details: input.error.issues });
      return;
    }
    const device = await store.getDevice(input.data.device_id);
    if (!device || device.revokedAt) {
      response.status(404).json({ error: "device_not_available" });
      return;
    }
    try {
      const command = await store.enqueue(input.data.device_id, input.data.operation, input.data.ttl_seconds);
      response.status(202).json({ command });
    } catch (error) {
      if (error instanceof BridgeDeviceUnavailableError) {
        response.status(404).json({ error: "device_not_available" });
        return;
      }
      if (error instanceof BridgeRequestConflictError) {
        response.status(409).json({ error: "request_id_conflict" });
        return;
      }
      throw error;
    }
  });

  router.get("/admin/commands/:commandId", adminAuth, adminRateLimit, async (request, response) => {
    const command = await store.getCommand(String(request.params.commandId));
    if (!command) {
      response.status(404).json({ error: "command_not_found" });
      return;
    }
    response.json({ command });
  });

  router.get(
    "/agent/commands/next",
    deviceAuth(store),
    pollRateLimit,
    async (request, response) => {
      if (!requireBridgeProtocol(request, response)) return;
      const deviceId = response.locals.deviceId as string;
      await store.touchDevice(deviceId, new Date().toISOString());
      const command = await store.leaseNext(deviceId, BRIDGE_LEASE_SECONDS);
      if (!command) {
        response.status(204).end();
        return;
      }
      response.json({ command });
    },
  );

  router.post(
    "/agent/commands/:commandId/result",
    deviceAuth(store),
    resultRateLimit,
    async (request, response) => {
      if (!requireBridgeProtocol(request, response)) return;
      const input = resultSchema.safeParse(request.body);
      if (!input.success) {
        response.status(400).json({ error: "invalid_request", details: input.error.issues });
        return;
      }
      const deviceId = response.locals.deviceId as string;
      await store.touchDevice(deviceId, new Date().toISOString());
      const commandId = String(request.params.commandId);
      const command = input.data.status === "succeeded"
        ? await store.complete(commandId, deviceId, input.data.lease_id, input.data.result ?? null)
        : await store.fail(
          commandId,
          deviceId,
          input.data.lease_id,
          input.data.error ?? "Device command failed.",
        );
      if (!command) {
        response.status(409).json({ error: "command_not_leased_to_device" });
        return;
      }
      response.json({ command_id: command.id, status: command.status });
    },
  );

  return router;
}
