import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AmbientAdapter } from "./domain.js";
import { AmbientAdapterError } from "./domain.js";
import { log } from "./logger.js";
import {
  channelSchema,
  channelSummarySchema,
  commandOutputSchema,
  confirmationSchema,
  displayScopeSchema,
  historyItemSchema,
  idSchema,
  powerPolicySchema,
  requestIdSchema,
  statusOutputSchema,
} from "./schemas.js";

export const TOOL_METADATA = [
  {
    name: "get_status",
    title: "Get Ambient Status",
    description: "Use this when the user wants to know what Ambient is showing, why it was selected, or whether Ambient is paused.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "list_channels",
    title: "List Ambient Channels",
    description: "Use this when the user wants to see the existing wallpaper channels available in Ambient.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "get_channel",
    title: "Get Ambient Channel",
    description: "Use this when the user wants details about one existing Ambient channel before deciding whether to activate it.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "next_wallpaper",
    title: "Show Next Wallpaper",
    description: "Use this when the user explicitly asks Ambient to advance to the next wallpaper in the active channel. Requires explicit confirmation.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "activate_channel",
    title: "Activate Ambient Channel",
    description: "Use this when the user explicitly asks to activate an existing Ambient channel. Requires explicit confirmation.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "pause_ambient",
    title: "Pause Ambient",
    description: "Use this when the user explicitly asks to pause Ambient without deleting its configuration. Requires explicit confirmation.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "resume_ambient",
    title: "Resume Ambient",
    description: "Use this when the user explicitly asks Ambient to resume its existing rules. Requires explicit confirmation.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "set_power_policy",
    title: "Set Ambient Power Policy",
    description: "Use this when the user explicitly asks to change Ambient's still or live power behavior. Requires explicit confirmation.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "get_history",
    title: "Get Ambient History",
    description: "Use this when the user wants to inspect recent Ambient actions or find a previous scene that can be restored.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "restore_previous",
    title: "Restore Previous Ambient Scene",
    description: "Use this when the user explicitly asks to restore the most recent restorable Ambient scene. Requires explicit confirmation.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
] as const;

const metadata = Object.fromEntries(TOOL_METADATA.map((tool) => [tool.name, tool])) as Record<
  (typeof TOOL_METADATA)[number]["name"],
  (typeof TOOL_METADATA)[number]
>;

function toolMeta(invoking: string, invoked: string): Record<string, unknown> {
  return {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function textResult(structuredContent: object, summary: string) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: Object.fromEntries(Object.entries(structuredContent)),
  };
}

function errorResult(error: unknown) {
  const message =
    error instanceof AmbientAdapterError
      ? error.message
      : "Ambient could not complete this request. Check the companion app and try again.";
  const code = error instanceof AmbientAdapterError ? error.code : "internal_error";
  log("warn", "tool_error", { code, errorType: error instanceof Error ? error.name : typeof error });
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function createAmbientMcpServer(adapter: AmbientAdapter): McpServer {
  const server = new McpServer(
    { name: "project-ambient", version: "0.1.0" },
    {
      instructions:
        "Use read-only tools to inspect Ambient before changing it. State-changing tools require an explicit user confirmation plus a unique request_id. Never invent channel IDs, expose local file paths, request arbitrary URLs, or imply an action succeeded unless the tool result says it was applied.",
    },
  );

  server.registerTool(
    "get_status",
    {
      title: metadata.get_status.title,
      description: metadata.get_status.description,
      inputSchema: {},
      outputSchema: statusOutputSchema,
      annotations: metadata.get_status.annotations,
      _meta: toolMeta("Checking Ambient…", "Ambient status ready"),
    },
    async () => {
      try {
        const status = await adapter.getStatus();
        return textResult(
          status,
          status.paused
            ? `Ambient is paused. The current channel is ${status.currentChannelName ?? "not set"}.`
            : `${status.currentChannelName ?? "No channel"} is active with ${status.sceneTitle ?? "no scene"}. ${status.explanation}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_channels",
    {
      title: metadata.list_channels.title,
      description: metadata.list_channels.description,
      inputSchema: {},
      outputSchema: { channels: z.array(channelSummarySchema) },
      annotations: metadata.list_channels.annotations,
      _meta: toolMeta("Loading Ambient channels…", "Ambient channels ready"),
    },
    async () => {
      try {
        const channels = await adapter.listChannels();
        return textResult({ channels }, `Found ${channels.length} Ambient channels.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_channel",
    {
      title: metadata.get_channel.title,
      description: metadata.get_channel.description,
      inputSchema: {
        channel_id: idSchema.describe("An exact channel ID returned by list_channels."),
      },
      outputSchema: { channel: channelSchema },
      annotations: metadata.get_channel.annotations,
      _meta: toolMeta("Loading channel details…", "Channel details ready"),
    },
    async ({ channel_id }) => {
      try {
        const channel = await adapter.getChannel(channel_id);
        return textResult(
          { channel },
          `${channel.name} contains ${channel.mediaCount} items and uses the ${channel.powerPolicy} power policy.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "next_wallpaper",
    {
      title: metadata.next_wallpaper.title,
      description: metadata.next_wallpaper.description,
      inputSchema: {
        request_id: requestIdSchema,
        confirmation: confirmationSchema,
      },
      outputSchema: commandOutputSchema,
      annotations: metadata.next_wallpaper.annotations,
      _meta: toolMeta("Advancing Ambient…", "Wallpaper advanced"),
    },
    async ({ request_id }) => {
      try {
        const result = await adapter.next({ requestId: request_id });
        return textResult(result, result.message);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "activate_channel",
    {
      title: metadata.activate_channel.title,
      description: metadata.activate_channel.description,
      inputSchema: {
        channel_id: idSchema.describe("An exact channel ID returned by list_channels."),
        display_scope: displayScopeSchema.default("all"),
        duration_minutes: z.number().int().min(1).max(1_440).optional(),
        request_id: requestIdSchema,
        confirmation: confirmationSchema,
      },
      outputSchema: commandOutputSchema,
      annotations: metadata.activate_channel.annotations,
      _meta: toolMeta("Activating Ambient channel…", "Ambient channel activated"),
    },
    async ({ channel_id, display_scope, duration_minutes, request_id }) => {
      try {
        const result = await adapter.activateChannel({
          channelId: channel_id,
          displayScope: display_scope,
          ...(duration_minutes === undefined ? {} : { durationMinutes: duration_minutes }),
          requestId: request_id,
        });
        return textResult(result, result.message);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "pause_ambient",
    {
      title: metadata.pause_ambient.title,
      description: metadata.pause_ambient.description,
      inputSchema: {
        duration_minutes: z.number().int().min(1).max(1_440).optional(),
        request_id: requestIdSchema,
        confirmation: confirmationSchema,
      },
      outputSchema: commandOutputSchema,
      annotations: metadata.pause_ambient.annotations,
      _meta: toolMeta("Pausing Ambient…", "Ambient paused"),
    },
    async ({ duration_minutes, request_id }) => {
      try {
        const result = await adapter.pause({
          ...(duration_minutes === undefined ? {} : { durationMinutes: duration_minutes }),
          requestId: request_id,
        });
        return textResult(result, result.message);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "resume_ambient",
    {
      title: metadata.resume_ambient.title,
      description: metadata.resume_ambient.description,
      inputSchema: {
        request_id: requestIdSchema,
        confirmation: confirmationSchema,
      },
      outputSchema: commandOutputSchema,
      annotations: metadata.resume_ambient.annotations,
      _meta: toolMeta("Resuming Ambient…", "Ambient resumed"),
    },
    async ({ request_id }) => {
      try {
        const result = await adapter.resume({ requestId: request_id });
        return textResult(result, result.message);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "set_power_policy",
    {
      title: metadata.set_power_policy.title,
      description: metadata.set_power_policy.description,
      inputSchema: {
        policy: powerPolicySchema.describe("Still, adaptive, live on AC power, or always live."),
        request_id: requestIdSchema,
        confirmation: confirmationSchema,
      },
      outputSchema: commandOutputSchema,
      annotations: metadata.set_power_policy.annotations,
      _meta: toolMeta("Updating Ambient power policy…", "Power policy updated"),
    },
    async ({ policy, request_id }) => {
      try {
        const result = await adapter.setPowerPolicy({ policy, requestId: request_id });
        return textResult(result, result.message);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_history",
    {
      title: metadata.get_history.title,
      description: metadata.get_history.description,
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10),
      },
      outputSchema: { items: z.array(historyItemSchema) },
      annotations: metadata.get_history.annotations,
      _meta: toolMeta("Loading Ambient history…", "Ambient history ready"),
    },
    async ({ limit }) => {
      try {
        const items = await adapter.getHistory(limit);
        return textResult({ items }, `Loaded ${items.length} recent Ambient history items.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "restore_previous",
    {
      title: metadata.restore_previous.title,
      description: metadata.restore_previous.description,
      inputSchema: {
        request_id: requestIdSchema,
        confirmation: confirmationSchema,
      },
      outputSchema: commandOutputSchema,
      annotations: metadata.restore_previous.annotations,
      _meta: toolMeta("Restoring previous scene…", "Previous scene restored"),
    },
    async ({ request_id }) => {
      try {
        const result = await adapter.restorePrevious({ requestId: request_id });
        return textResult(result, result.message);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
