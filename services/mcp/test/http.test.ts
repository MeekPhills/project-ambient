import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DemoAmbientAdapter } from "../src/adapters/demo.js";
import { MemoryBridgeStore } from "../src/bridge/store.js";
import type { BridgeRateLimitScope } from "../src/bridge/types.js";
import { createHttpApp, parseAllowedHosts, parseTrustedProxies } from "../src/http-app.js";

function requestWithHost(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      headers: { Host: host },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end();
  });
}

class TestDistributedRateLimitStore extends MemoryBridgeStore {
  readonly distributedRateLimit = true;
  private readonly counters = new Map<string, number>();

  async incrementRateLimit(scope: BridgeRateLimitScope, keyHash: string, windowMs: number) {
    const key = `${scope}\0${keyHash}`;
    const totalHits = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, totalHits);
    return { totalHits, resetTime: new Date(Date.now() + windowMs) };
  }

  async decrementRateLimit(scope: BridgeRateLimitScope, keyHash: string): Promise<void> {
    const key = `${scope}\0${keyHash}`;
    const count = this.counters.get(key) ?? 0;
    if (count <= 1) this.counters.delete(key);
    else this.counters.set(key, count - 1);
  }

  async resetRateLimit(scope: BridgeRateLimitScope, keyHash: string): Promise<void> {
    this.counters.delete(`${scope}\0${keyHash}`);
  }
}

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

test("public host configuration preserves health and MCP auth semantics", async (t) => {
  const rateLimitStore = new TestDistributedRateLimitStore();
  const app = createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    authToken: "test-secret-token-0123456789abcdef",
    host: "0.0.0.0",
    allowedHosts: ["project-ambient-control.vercel.app"],
    publicRateLimitStore: rateLimitStore,
    vercel: true,
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve()))));
  const { port } = listener.address() as AddressInfo;
  assert.equal(await requestWithHost(port, "/health", "project-ambient-control.vercel.app"), 200);
  assert.equal(await requestWithHost(port, "/mcp", "project-ambient-control.vercel.app"), 401);
  assert.equal(await requestWithHost(port, "/health", "attacker.example"), 403);
});

test("public application construction rejects missing or short MCP authentication", () => {
  const common = {
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo" as const,
    host: "0.0.0.0",
    allowedHosts: ["public.example"],
    publicRateLimitStore: new TestDistributedRateLimitStore(),
    vercel: true,
  };
  assert.throws(() => createHttpApp(common), /MCP_AUTH_TOKEN must contain at least 32 bytes/);
  assert.throws(() => createHttpApp({ ...common, authToken: "short" }), /at least 32 bytes/);
});

test("trusted proxy configuration accepts narrow IP/CIDR lists and rejects catch-all trust", () => {
  assert.deepEqual(parseTrustedProxies(undefined), []);
  assert.deepEqual(
    parseTrustedProxies("127.0.0.1, 10.20.0.0/16,2001:db8::/48"),
    ["127.0.0.1", "10.20.0.0/16", "2001:db8::/48"],
  );
  for (const invalid of ["", "proxy.example", "10.0.0.0/33", "2001:db8::/129", "0.0.0.0/0", "::/0"]) {
    assert.throws(() => parseTrustedProxies(invalid), /BRIDGE_TRUSTED_PROXIES/);
  }
});

test("allowed host configuration accepts exact hosts and rejects schemes, paths, and wildcards", () => {
  assert.deepEqual(parseAllowedHosts(undefined), []);
  assert.deepEqual(
    parseAllowedHosts("Project-Ambient.Example,preview.vercel.app"),
    ["project-ambient.example", "preview.vercel.app"],
  );
  for (const invalid of ["", "*", "https://example.com", "example.com/path", "user@example.com"]) {
    assert.throws(() => parseAllowedHosts(invalid), /MCP_ALLOWED_HOSTS/);
  }
});

test("remote bridge topology cannot use local limiting or omit explicit proxy trust", () => {
  const common = {
    adapter: new DemoAmbientAdapter(),
    adapterKind: "remote" as const,
    bridgeStore: new MemoryBridgeStore(),
    bridgeAdminToken: "local-admin-token",
    host: "127.0.0.1",
  };
  assert.throws(() => createHttpApp(common), /distributed rate limiting/);
  assert.throws(() => createHttpApp({
    ...common,
    bridgeStore: new TestDistributedRateLimitStore(),
    bridgeRateLimits: { distributed: true },
  }), /explicit trusted proxy/);
});

test("Vercel provenance never waives the bridge distributed-store requirement", () => {
  assert.throws(() => createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    authToken: "test-secret-token-0123456789abcdef",
    host: "0.0.0.0",
    allowedHosts: ["public.example"],
    publicRateLimitStore: new TestDistributedRateLimitStore(),
    bridgeStore: new MemoryBridgeStore(),
    bridgeAdminToken: "bridge-admin-token-0123456789abcdef",
    bridgeRateLimits: { distributed: true, vercel: true },
    vercel: true,
  }), /public bridge requires PostgreSQL-backed distributed rate limiting/i);
});

test("public and remote application construction requires explicit allowed hosts", () => {
  assert.throws(() => createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    authToken: "test-secret-token-0123456789abcdef",
    host: "0.0.0.0",
    publicRateLimitStore: new TestDistributedRateLimitStore(),
    vercel: true,
  }), /explicit allowed host list/);
});

test("authorized MCP routes share a direct quota and ingress rejects before body parsing", async (t) => {
  const create = (ingressLimit: number, authorizedLimit: number) => createHttpApp({
    adapter: new DemoAmbientAdapter(),
    adapterKind: "demo",
    authToken: "test-secret-token",
    host: "127.0.0.1",
    mcpRateLimits: { windowMs: 60_000, ingressLimit, authorizedLimit },
  });
  const authorizedApp = create(20, 1);
  const authorizedListener = authorizedApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => authorizedListener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => (
    authorizedListener.close((error) => (error ? reject(error) : resolve()))
  )));
  const authorizedPort = (authorizedListener.address() as AddressInfo).port;
  const authorization = { authorization: "Bearer test-secret-token" };
  assert.equal((await fetch(`http://127.0.0.1:${authorizedPort}/ready`, { headers: authorization })).status, 200);
  const directLimited = await fetch(`http://127.0.0.1:${authorizedPort}/mcp`, { headers: authorization });
  assert.equal(directLimited.status, 429);
  assert.equal(directLimited.headers.get("cache-control"), "no-store");
  assert.ok(directLimited.headers.get("retry-after"));
  assert.deepEqual(await directLimited.json(), { error: "rate_limit_exceeded" });

  const ingressApp = create(1, 20);
  const ingressListener = ingressApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => ingressListener.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => (
    ingressListener.close((error) => (error ? reject(error) : resolve()))
  )));
  const ingressPort = (ingressListener.address() as AddressInfo).port;
  assert.equal((await fetch(`http://127.0.0.1:${ingressPort}/mcp`)).status, 401);
  const preParseLimited = await fetch(`http://127.0.0.1:${ingressPort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ oversized: "x".repeat(200_000) }),
  });
  assert.equal(preParseLimited.status, 429);
  assert.deepEqual(await preParseLimited.json(), { error: "rate_limit_exceeded" });
});
