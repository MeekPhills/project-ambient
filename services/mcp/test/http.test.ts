import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import { createHttpApp } from "../src/http-app.js";

test("HTTP service exposes health, enforces optional bearer auth, and serves MCP", async (t) => {
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(() => new Date("2026-08-12T15:30:00.000Z")),
    adapterKind: "demo",
    authToken: "test-secret-token",
    host: "127.0.0.1",
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve()))));

  const { port } = listener.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { status: string }).status, "ok");

  const unauthorized = await fetch(`${baseUrl}/ready`);
  assert.equal(unauthorized.status, 401);
  const ready = await fetch(`${baseUrl}/ready`, {
    headers: { authorization: "Bearer test-secret-token" },
  });
  assert.equal(ready.status, 200);

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: "Bearer test-secret-token" } },
  });
  const client = new Client({ name: "ambient-http-test", version: "1.0.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const tools = await client.listTools();
  assert.equal(tools.tools.length, 10);
  const status = await client.callTool({ name: "get_status", arguments: {} });
  const statusContent = status.structuredContent as Record<string, unknown> | undefined;
  assert.equal(statusContent?.deviceId, "ambient-demo-mac");
});
