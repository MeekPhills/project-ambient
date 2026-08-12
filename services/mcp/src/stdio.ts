#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { adapterKindFrom, createAdapter } from "./adapter-factory.js";
import { log } from "./logger.js";
import { createAmbientMcpServer } from "./server.js";

const adapterKind = adapterKindFrom(process.env.AMBIENT_ADAPTER, "ambientctl");
const server = createAmbientMcpServer(createAdapter(adapterKind));
const transport = new StdioServerTransport();

await server.connect(transport);
log("info", "stdio_started", { adapter: adapterKind });

async function shutdown(signal: string): Promise<void> {
  log("info", "stdio_stopping", { signal });
  await server.close();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
