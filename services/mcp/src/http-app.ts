import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AmbientAdapter } from "./domain.js";
import { bearerAuth } from "./auth.js";
import { log } from "./logger.js";
import { createAmbientMcpServer } from "./server.js";
import type { BridgeStore } from "./bridge/types.js";
import { createBridgeRouter } from "./bridge/routes.js";

export interface HttpAppOptions {
  adapter: AmbientAdapter;
  adapterKind: "ambientctl" | "demo" | "remote";
  authToken?: string;
  host?: string;
  allowedHosts?: string[];
  bridgeStore?: BridgeStore;
  bridgeAdminToken?: string;
}

export function createHttpApp(options: HttpAppOptions) {
  const host = options.host ?? "127.0.0.1";
  const app = createMcpExpressApp({
    host,
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
  });

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    const requestId = request.header("x-request-id")?.slice(0, 128) || randomUUID();
    response.setHeader("X-Request-Id", requestId);
    const startedAt = performance.now();
    response.on("finish", () => {
      log("info", "http_request", {
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "project-ambient-mcp",
      version: "0.1.0",
      adapter: options.adapterKind,
    });
  });

  app.get("/ready", bearerAuth(options.authToken), async (_request, response) => {
    try {
      const status = await options.adapter.getStatus();
      response.json({ status: "ready", deviceOnline: status.online, adapter: options.adapterKind });
    } catch {
      response.status(503).json({ status: "not_ready", adapter: options.adapterKind });
    }
  });

  if (options.bridgeStore) {
    if (!options.bridgeAdminToken) {
      throw new Error("BRIDGE_ADMIN_TOKEN is required when bridge routes are enabled.");
    }
    app.use(
      "/bridge/v1",
      createBridgeRouter(options.bridgeStore, bearerAuth(options.bridgeAdminToken)),
    );
  }

  const handleMcpPost = async (request: Request, response: Response): Promise<void> => {
    const server = createAmbientMcpServer(options.adapter);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.once("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      log("error", "mcp_request_failed", { errorType: error instanceof Error ? error.name : typeof error });
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", bearerAuth(options.authToken), (request, response) => {
    void handleMcpPost(request, response);
  });
  app.get("/mcp", bearerAuth(options.authToken), (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode." },
      id: null,
    });
  });
  app.delete("/mcp", bearerAuth(options.authToken), (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode." },
      id: null,
    });
  });

  return app;
}
