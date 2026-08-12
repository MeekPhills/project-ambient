import type { AmbientAdapter } from "./domain.js";
import { AmbientCtlAdapter } from "./adapters/ambientctl.js";
import { DemoAmbientAdapter } from "./adapters/demo.js";
import type { BridgeStore } from "./bridge/types.js";
import { RemoteAmbientAdapter } from "./bridge/remote-adapter.js";

export type AdapterKind = "ambientctl" | "demo" | "remote";

export function createAdapter(kind: AdapterKind, options: { bridgeStore?: BridgeStore; deviceId?: string } = {}): AmbientAdapter {
  if (kind === "ambientctl") return new AmbientCtlAdapter();
  if (kind === "remote") {
    if (!options.bridgeStore || !options.deviceId) {
      throw new Error("Remote adapter requires a bridge store and AMBIENT_DEVICE_ID.");
    }
    return new RemoteAmbientAdapter({ store: options.bridgeStore, deviceId: options.deviceId });
  }
  return new DemoAmbientAdapter();
}

export function adapterKindFrom(value: string | undefined, fallback: AdapterKind): AdapterKind {
  if (value === undefined || value === "") return fallback;
  if (value === "ambientctl" || value === "demo" || value === "remote") return value;
  throw new Error("AMBIENT_ADAPTER must be 'ambientctl', 'demo', or 'remote'.");
}
