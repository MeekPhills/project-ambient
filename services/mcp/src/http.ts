import { adapterKindFrom, createAdapter } from "./adapter-factory.js";
import {
  createHttpApp,
  isLoopbackHost,
  parseAllowedHosts,
  parseTrustedProxies,
} from "./http-app.js";
import { log } from "./logger.js";
import { createBridgeStoreFromEnv } from "./bridge/store-factory.js";
import {
  validateBridgeSecurityConfiguration,
  validatePublicMcpAuthentication,
} from "./bridge/security-config.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const adapterKind = adapterKindFrom(process.env.AMBIENT_ADAPTER, "demo");
const bridgeEnabled = Boolean(process.env.BRIDGE_ADMIN_TOKEN || process.env.BRIDGE_STORE_PATH || adapterKind === "remote");
const publicOrRemote = !isLoopbackHost(host) || adapterKind === "remote";
validatePublicMcpAuthentication(publicOrRemote, process.env.MCP_AUTH_TOKEN);
validateBridgeSecurityConfiguration({
  bridgeEnabled,
  publicOrRemote,
  mcpToken: process.env.MCP_AUTH_TOKEN,
  adminToken: process.env.BRIDGE_ADMIN_TOKEN,
});
const { store: bridgeStore, kind: bridgeStoreKind } = createBridgeStoreFromEnv();
const trustedProxies = parseTrustedProxies(process.env.BRIDGE_TRUSTED_PROXIES);
const publicHttp = !isLoopbackHost(host);
const allowedHosts = parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS);
if (publicHttp || publicOrRemote) {
  if (bridgeStoreKind !== "postgres") {
    throw new Error("A public or remote service requires PostgreSQL-backed distributed rate limiting.");
  }
  if (trustedProxies.length === 0) {
    throw new Error("A public or remote service requires BRIDGE_TRUSTED_PROXIES.");
  }
  if (allowedHosts.length === 0) {
    throw new Error("A public or remote service requires MCP_ALLOWED_HOSTS.");
  }
}
if (bridgeEnabled || publicHttp || publicOrRemote) await bridgeStore.initialize();
const adapter = createAdapter(adapterKind, {
  bridgeStore,
  deviceId: process.env.AMBIENT_DEVICE_ID,
});
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const app = createHttpApp({
  adapter,
  adapterKind,
  host,
  ...(process.env.MCP_AUTH_TOKEN === undefined ? {} : { authToken: process.env.MCP_AUTH_TOKEN }),
  ...(allowedHosts.length === 0 ? {} : { allowedHosts }),
  ...(trustedProxies.length === 0 ? {} : { trustedProxies }),
  ...((publicHttp || publicOrRemote) ? { publicRateLimitStore: bridgeStore } : {}),
  ...(bridgeEnabled ? {
    bridgeStore,
    bridgeAdminToken: process.env.BRIDGE_ADMIN_TOKEN,
    bridgeRateLimits: { distributed: bridgeStoreKind === "postgres" },
  } : {}),
});

const listener = app.listen(port, host, () => {
  log("info", "server_started", {
    host,
    port,
    adapter: adapterKind,
    bridgeStore: bridgeEnabled ? bridgeStoreKind : "disabled",
    authEnabled: Boolean(process.env.MCP_AUTH_TOKEN),
  });
});

function shutdown(signal: string): void {
  log("info", "server_stopping", { signal });
  listener.close((error) => {
    if (error) {
      log("error", "server_stop_failed", { errorType: error.name });
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
