import { adapterKindFrom, createAdapter } from "./adapter-factory.js";
import { createHttpApp } from "./http-app.js";
import { log } from "./logger.js";
import { createBridgeStoreFromEnv } from "./bridge/store-factory.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const adapterKind = adapterKindFrom(process.env.AMBIENT_ADAPTER, "demo");
const bridgeEnabled = Boolean(process.env.BRIDGE_ADMIN_TOKEN || process.env.BRIDGE_STORE_PATH || adapterKind === "remote");
const { store: bridgeStore, kind: bridgeStoreKind } = createBridgeStoreFromEnv();
const adapter = createAdapter(adapterKind, {
  bridgeStore,
  deviceId: process.env.AMBIENT_DEVICE_ID,
});
const allowedHosts = process.env.MCP_ALLOWED_HOSTS
  ?.split(",")
  .map((hostName) => hostName.trim())
  .filter(Boolean);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const app = createHttpApp({
  adapter,
  adapterKind,
  host,
  ...(process.env.MCP_AUTH_TOKEN === undefined ? {} : { authToken: process.env.MCP_AUTH_TOKEN }),
  ...(allowedHosts === undefined ? {} : { allowedHosts }),
  ...(bridgeEnabled ? { bridgeStore, bridgeAdminToken: process.env.BRIDGE_ADMIN_TOKEN } : {}),
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
