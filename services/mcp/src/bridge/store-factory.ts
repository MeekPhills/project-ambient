import type { BridgeStore } from "./types.js";
import { JsonFileBridgeStore, MemoryBridgeStore } from "./store.js";
import { PostgresBridgeStore } from "./postgres-store.js";

export type BridgeStoreKind = "postgres" | "json" | "memory";

export function createBridgeStoreFromEnv(): { store: BridgeStore; kind: BridgeStoreKind } {
  const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (connectionString) {
    return { store: new PostgresBridgeStore({ connectionString }), kind: "postgres" };
  }
  if (process.env.BRIDGE_STORE_PATH) {
    return { store: new JsonFileBridgeStore(process.env.BRIDGE_STORE_PATH), kind: "json" };
  }
  return { store: new MemoryBridgeStore(), kind: "memory" };
}
