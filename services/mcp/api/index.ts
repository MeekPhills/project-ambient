import { adapterKindFrom, createAdapter } from "../src/adapter-factory.js";
import { createHttpApp, parseAllowedHosts } from "../src/http-app.js";
import { createBridgeStoreFromEnv } from "../src/bridge/store-factory.js";
import {
  validateBridgeSecurityConfiguration,
  validatePublicMcpAuthentication,
} from "../src/bridge/security-config.js";

const adapterKind = adapterKindFrom(process.env.AMBIENT_ADAPTER, "demo");
if (adapterKind === "ambientctl") {
  throw new Error("The Vercel function cannot run ambientctl. Use AMBIENT_ADAPTER=demo or remote.");
}
validatePublicMcpAuthentication(true, process.env.MCP_AUTH_TOKEN);

const databaseConfigured = Boolean(process.env.POSTGRES_URL ?? process.env.DATABASE_URL);
if (!databaseConfigured) {
  throw new Error("The public Vercel MCP service requires POSTGRES_URL or DATABASE_URL for distributed limiting.");
}
const bridgeEnabled = Boolean(process.env.BRIDGE_ADMIN_TOKEN || adapterKind === "remote");
validateBridgeSecurityConfiguration({
  bridgeEnabled,
  publicOrRemote: true,
  mcpToken: process.env.MCP_AUTH_TOKEN,
  adminToken: process.env.BRIDGE_ADMIN_TOKEN,
});

const { store: bridgeStore, kind: bridgeStoreKind } = createBridgeStoreFromEnv();
await bridgeStore.initialize();
if (bridgeStoreKind !== "postgres") {
  throw new Error("The Vercel service requires PostgreSQL-backed distributed rate limiting.");
}
const adapter = createAdapter(adapterKind, {
  bridgeStore,
  deviceId: process.env.AMBIENT_DEVICE_ID,
});
const allowedHosts = Array.from(new Set([
  "project-ambient-control.vercel.app",
  ...parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS),
  ...parseAllowedHosts(process.env.VERCEL_URL),
  ...parseAllowedHosts(process.env.VERCEL_BRANCH_URL),
]));

const app = createHttpApp({
  adapter,
  adapterKind,
  host: "0.0.0.0",
  publicRateLimitStore: bridgeStore,
  vercel: true,
  allowedHosts,
  ...(process.env.MCP_AUTH_TOKEN === undefined ? {} : { authToken: process.env.MCP_AUTH_TOKEN }),
  ...(bridgeEnabled
    ? {
      bridgeStore,
      bridgeAdminToken: process.env.BRIDGE_ADMIN_TOKEN,
      bridgeRateLimits: { distributed: true, vercel: true },
    }
    : {}),
});

export default app;
