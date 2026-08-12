import * as z from "zod/v4";
import { DISPLAY_SCOPES, POWER_POLICIES } from "./domain.js";

export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Use an Ambient identifier, not a path or URL.");

export const requestIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, "Use an opaque request identifier.")
  .describe("Unique idempotency key for this user-confirmed action.");

export const confirmationSchema = z
  .literal("confirmed")
  .describe("Set to 'confirmed' only after the user explicitly approves this state change.");

export const powerPolicySchema = z.enum(POWER_POLICIES);
export const displayScopeSchema = z.enum(DISPLAY_SCOPES);
export const rendererSchema = z.enum(["still", "aerial", "native_live"]);

export const statusOutputSchema = {
  deviceId: z.string(),
  displayName: z.string(),
  appVersion: z.string(),
  online: z.boolean(),
  paused: z.boolean(),
  currentChannelId: z.string().nullable(),
  currentChannelName: z.string().nullable(),
  sceneTitle: z.string().nullable(),
  winningRule: z.string().nullable(),
  explanation: z.string(),
  powerPolicy: powerPolicySchema,
  renderer: rendererSchema,
  appliedAt: z.string().nullable(),
};

export const channelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  mediaCount: z.number().int().nonnegative(),
  rendererCompatibility: z.array(rendererSchema),
  rightsStatus: z.enum(["user_owned", "licensed", "unknown"]),
  active: z.boolean(),
});

export const channelSchema = channelSummarySchema.extend({
  tags: z.array(z.string()),
  rules: z.array(z.string()),
  powerPolicy: powerPolicySchema,
  sceneTitles: z.array(z.string()),
});

export const commandOutputSchema = {
  commandId: z.string(),
  status: z.enum(["applied", "already_applied", "scheduled"]),
  message: z.string(),
  requestId: z.string(),
  effectiveChannelId: z.string().nullable(),
  effectivePowerPolicy: powerPolicySchema,
  paused: z.boolean(),
  undoAvailable: z.boolean(),
  appliedAt: z.string(),
};

export const historyItemSchema = z.object({
  id: z.string(),
  action: z.enum(["next", "activate", "pause", "resume", "power_policy", "restore"]),
  occurredAt: z.string(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  sceneTitle: z.string().nullable(),
  explanation: z.string(),
  restorable: z.boolean(),
});

export const statusSchema = z.object(statusOutputSchema);
export const commandSchema = z.object(commandOutputSchema);
export const historySchema = z.array(historyItemSchema);
export const channelListSchema = z.array(channelSummarySchema);
