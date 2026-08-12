import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import { createAmbientMcpServer, TOOL_METADATA } from "../src/server.js";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAmbientMcpServer(
    new DemoAmbientAdapter(() => new Date("2026-08-12T15:30:00.000Z")),
  );
  const client = new Client({ name: "ambient-contract-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("server publishes one-intent tools with complete impact annotations", async (t) => {
  const { client, server } = await connectedClient();
  t.after(async () => Promise.all([client.close(), server.close()]));
  const result = await client.listTools();

  assert.equal(result.tools.length, TOOL_METADATA.length);
  assert.deepEqual(
    result.tools.map((tool) => tool.name).sort(),
    TOOL_METADATA.map((tool) => tool.name).sort(),
  );
  for (const tool of result.tools) {
    assert.match(tool.description ?? "", /^Use this when/);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean");
    assert.equal(typeof tool.annotations?.destructiveHint, "boolean");
    assert.equal(typeof tool.annotations?.openWorldHint, "boolean");
    assert.equal(typeof tool.annotations?.idempotentHint, "boolean");
    assert.ok(tool.outputSchema, `${tool.name} needs an output schema`);
  }
});

test("read and confirmed mutation calls return validated structured output", async (t) => {
  const { client, server } = await connectedClient();
  t.after(async () => Promise.all([client.close(), server.close()]));

  const status = await client.callTool({ name: "get_status", arguments: {} });
  const statusContent = status.structuredContent as Record<string, unknown> | undefined;
  assert.equal(status.isError, undefined);
  assert.equal(statusContent?.currentChannelId, "beaches");

  const requestId = "contract-test-00000001";
  const first = await client.callTool({
    name: "activate_channel",
    arguments: {
      channel_id: "quiet-nature",
      display_scope: "all",
      request_id: requestId,
      confirmation: "confirmed",
    },
  });
  const retry = await client.callTool({
    name: "activate_channel",
    arguments: {
      channel_id: "quiet-nature",
      display_scope: "all",
      request_id: requestId,
      confirmation: "confirmed",
    },
  });
  const firstContent = first.structuredContent as Record<string, unknown> | undefined;
  const retryContent = retry.structuredContent as Record<string, unknown> | undefined;

  assert.equal(firstContent?.status, "applied");
  assert.equal(retryContent?.status, "already_applied");
  assert.equal(firstContent?.commandId, retryContent?.commandId);
});

test("persistent mutations reject missing confirmation and path-like identifiers", async (t) => {
  const { client, server } = await connectedClient();
  t.after(async () => Promise.all([client.close(), server.close()]));

  const missingConfirmation = await client.callTool({
    name: "set_power_policy",
    arguments: { policy: "still", request_id: "contract-test-00000002" },
  });
  assert.equal(missingConfirmation.isError, true);

  const pathIdentifier = await client.callTool({
    name: "get_channel",
    arguments: { channel_id: "../../private/file" },
  });
  assert.equal(pathIdentifier.isError, true);
});
