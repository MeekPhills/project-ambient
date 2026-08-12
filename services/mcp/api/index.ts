import { adapterKindFrom, createAdapter } from "../src/adapter-factory.js";
import { createHttpApp } from "../src/http-app.js";
import { createBridgeStoreFromEnv } from "../src/bridge/store-factory.js";

const production = process.env.VERCEL_ENV === "production";
const requireStrongToken = (name: string, value: string | undefined): void => {
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes in production.`);
  }
};

if (production) requireStrongToken("MCP_AUTH_TOKEN", process.env.MCP_AUTH_TOKEN);

const adapterKind = adapterKindFrom(process.env.AMBIENT_ADAPTER, "demo");
if (adapterKind === "ambientctl") {
  throw new Error("The Vercel function cannot run ambientctl. Use AMBIENT_ADAPTER=demo or remote.");
}

const databaseConfigured = Boolean(process.env.POSTGRES_URL ?? process.env.DATABASE_URL);
const bridgeEnabled = Boolean(process.env.BRIDGE_ADMIN_TOKEN || adapterKind === "remote");
if (bridgeEnabled && !databaseConfigured) {
  throw new Error("The Vercel bridge requires POSTGRES_URL or DATABASE_URL for a shared durable queue.");
}
if (bridgeEnabled && production) requireStrongToken("BRIDGE_ADMIN_TOKEN", process.env.BRIDGE_ADMIN_TOKEN);

const { store: bridgeStore } = createBridgeStoreFromEnv();
const adapter = createAdapter(adapterKind, {
  bridgeStore,
  deviceId: process.env.AMBIENT_DEVICE_ID,
});

const app = createHttpApp({
  adapter,
  adapterKind,
  host: "0.0.0.0",
  ...(process.env.MCP_AUTH_TOKEN === undefined ? {} : { authToken: process.env.MCP_AUTH_TOKEN }),
  ...(bridgeEnabled
    ? { bridgeStore, bridgeAdminToken: process.env.BRIDGE_ADMIN_TOKEN }
    : {}),
});

export default app;
