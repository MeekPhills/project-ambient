import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import * as z from "zod/v4";
import type { BridgeStore } from "./types.js";
import { bridgeOperationSchema } from "./types.js";

const enrollmentSchema = z.object({ display_name: z.string().min(1).max(80) });
const commandSchema = z.object({
  device_id: z.string().min(1).max(128),
  operation: bridgeOperationSchema,
  ttl_seconds: z.number().int().min(5).max(300).default(60),
});
const resultSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  result: z.unknown().optional(),
  error: z.string().max(500).optional(),
});

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
    await store.touchDevice(credentials.deviceId, new Date().toISOString());
    next();
  };
}

export function createBridgeRouter(store: BridgeStore, adminAuth: RequestHandler): Router {
  const router = express.Router();

  router.post("/admin/devices/enroll", adminAuth, async (request, response) => {
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

  router.post("/admin/devices/:deviceId/revoke", adminAuth, async (request, response) => {
    const deviceId = String(request.params.deviceId);
    const revoked = await store.revokeDevice(deviceId, new Date().toISOString());
    if (!revoked) {
      response.status(404).json({ error: "device_not_found_or_already_revoked" });
      return;
    }
    response.json({ status: "revoked", device_id: deviceId });
  });

  router.post("/admin/commands", adminAuth, async (request, response) => {
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
    const command = await store.enqueue(input.data.device_id, input.data.operation, input.data.ttl_seconds);
    response.status(202).json({ command });
  });

  router.get("/admin/commands/:commandId", adminAuth, async (request, response) => {
    const command = await store.getCommand(String(request.params.commandId));
    if (!command) {
      response.status(404).json({ error: "command_not_found" });
      return;
    }
    response.json({ command });
  });

  router.get("/agent/commands/next", deviceAuth(store), async (_request, response) => {
    const deviceId = response.locals.deviceId as string;
    const command = await store.leaseNext(deviceId, 30);
    if (!command) {
      response.status(204).end();
      return;
    }
    response.json({ command });
  });

  router.post("/agent/commands/:commandId/result", deviceAuth(store), async (request, response) => {
    const input = resultSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "invalid_request", details: input.error.issues });
      return;
    }
    const deviceId = response.locals.deviceId as string;
    const commandId = String(request.params.commandId);
    const command = input.data.status === "succeeded"
      ? await store.complete(commandId, deviceId, input.data.result ?? null)
      : await store.fail(commandId, deviceId, input.data.error ?? "Device command failed.");
    if (!command) {
      response.status(409).json({ error: "command_not_leased_to_device" });
      return;
    }
    response.json({ command_id: command.id, status: command.status });
  });

  return router;
}
