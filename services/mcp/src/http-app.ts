import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Request, Response } from "express";
import express from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  hostHeaderValidation,
  localhostHostValidation,
} from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AmbientAdapter } from "./domain.js";
import { bearerAuth } from "./auth.js";
import { log } from "./logger.js";
import { createAmbientMcpServer } from "./server.js";
import type { BridgeStore } from "./bridge/types.js";
import { validatePublicMcpAuthentication } from "./bridge/security-config.js";
import {
  BridgeRateLimitStore,
  BridgeRateLimitUnavailableError,
} from "./bridge/rate-limit-store.js";
import {
  createBridgeIngressRateLimiter,
  createBridgeRouter,
  bridgeRateLimitErrorHandler,
  type BridgeRateLimitOptions,
} from "./bridge/routes.js";

export interface HttpAppOptions {
  adapter: AmbientAdapter;
  adapterKind: "ambientctl" | "demo" | "remote";
  authToken?: string;
  host?: string;
  allowedHosts?: string[];
  bridgeStore?: BridgeStore;
  bridgeAdminToken?: string;
  bridgeRateLimits?: BridgeRateLimitOptions;
  trustedProxies?: string[];
  mcpRateLimits?: {
    windowMs?: number;
    ingressLimit?: number;
    authorizedLimit?: number;
  };
  publicRateLimitStore?: BridgeStore;
  vercel?: boolean;
}

export function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function isValidProxyAddress(value: string): boolean {
  const parts = value.split("/");
  if (parts.length > 2) return false;
  const family = isIP(parts[0] ?? "");
  if (family === 0) return false;
  const prefix = parts[1];
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const numericPrefix = Number(prefix);
  return numericPrefix >= 1 && numericPrefix <= (family === 4 ? 32 : 128);
}

export function parseTrustedProxies(value: string | undefined): string[] {
  if (value === undefined) return [];
  const proxies = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (proxies.length === 0 || proxies.some((entry) => !isValidProxyAddress(entry))) {
    throw new Error("BRIDGE_TRUSTED_PROXIES must be a nonempty comma-separated IP/CIDR list.");
  }
  return proxies;
}

export function parseAllowedHosts(value: string | undefined): string[] {
  if (value === undefined) return [];
  const hosts = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const valid = hosts.length > 0 && hosts.every((host) => {
    if (host === "*" || host.includes("/") || host.includes("\\") || host.includes("@")) return false;
    try {
      const parsed = new URL(`http://${host}`);
      return parsed.host === host && parsed.pathname === "/" && !parsed.search && !parsed.hash;
    } catch {
      return false;
    }
  });
  if (!valid) {
    throw new Error("MCP_ALLOWED_HOSTS must be a nonempty comma-separated hostname list without schemes or paths.");
  }
  return Array.from(new Set(hosts));
}

export function createHttpApp(options: HttpAppOptions) {
  const host = options.host ?? "127.0.0.1";
  if (options.trustedProxies?.some((entry) => !isValidProxyAddress(entry))) {
    throw new Error("trustedProxies entries must be IP addresses or CIDR ranges.");
  }
  if (options.allowedHosts) {
    const normalizedHosts = parseAllowedHosts(options.allowedHosts.join(","));
    if (normalizedHosts.length !== options.allowedHosts.length
      || normalizedHosts.some((hostName, index) => hostName !== options.allowedHosts?.[index])) {
      throw new Error("allowedHosts must contain unique normalized hostnames.");
    }
  }
  const hardenedBridge = options.bridgeStore
    && (!isLoopbackHost(host) || options.adapterKind === "remote");
  if (hardenedBridge) {
    if (!options.bridgeRateLimits?.distributed || !options.bridgeStore?.distributedRateLimit) {
      throw new Error("A public bridge requires PostgreSQL-backed distributed rate limiting.");
    }
    if (!options.bridgeRateLimits.vercel && !options.trustedProxies?.length) {
      throw new Error("A public bridge requires an explicit trusted proxy IP/CIDR list.");
    }
  }
  const publicMcp = !isLoopbackHost(host) || options.adapterKind === "remote";
  validatePublicMcpAuthentication(publicMcp, options.authToken);
  if (publicMcp && !options.publicRateLimitStore?.distributedRateLimit) {
    throw new Error("A public or remote MCP service requires PostgreSQL-backed distributed rate limiting.");
  }
  if (publicMcp && !options.vercel && !options.trustedProxies?.length) {
    throw new Error("A public or remote MCP service requires explicit trusted proxy provenance.");
  }
  if (publicMcp && !options.allowedHosts?.length) {
    throw new Error("A public or remote MCP service requires an explicit allowed host list.");
  }
  const app = express();
  if (options.trustedProxies?.length) app.set("trust proxy", options.trustedProxies);
  const mcpApp = createMcpExpressApp({
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

  if (options.allowedHosts) {
    app.use(hostHeaderValidation(options.allowedHosts));
  } else if (isLoopbackHost(host)) {
    app.use(localhostHostValidation());
  }

  const mcpClientKey = (request: Request): string => {
    if (options.vercel) {
      const raw = request.header("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
      return raw && isIP(raw) !== 0 ? ipKeyGenerator(raw) : "invalid-vercel-client-ip";
    }
    return ipKeyGenerator(request.ip ?? "unavailable-client-ip");
  };
  const mcpWindowMs = options.mcpRateLimits?.windowMs ?? 60_000;
  const mcpLimitResponse = (_request: Request, response: Response): void => {
    response.setHeader("Cache-Control", "no-store");
    response.status(429).json({ error: "rate_limit_exceeded" });
  };
  const mcpIngressRateLimit = rateLimit({
    windowMs: mcpWindowMs,
    limit: options.mcpRateLimits?.ingressLimit ?? 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "mcp-ingress",
    keyGenerator: mcpClientKey,
    ...(options.publicRateLimitStore === undefined ? {} : {
      store: new BridgeRateLimitStore(options.publicRateLimitStore, "mcp-ingress"),
    }),
    passOnStoreError: false,
    handler: mcpLimitResponse,
  });
  const mcpAuthorizedRateLimit = rateLimit({
    windowMs: mcpWindowMs,
    limit: options.mcpRateLimits?.authorizedLimit ?? 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "mcp-authorized",
    keyGenerator: mcpClientKey,
    ...(options.publicRateLimitStore === undefined ? {} : {
      store: new BridgeRateLimitStore(options.publicRateLimitStore, "mcp-authorized"),
    }),
    passOnStoreError: false,
    handler: mcpLimitResponse,
  });
  app.use(["/ready", "/mcp"], mcpIngressRateLimit);

  if (options.bridgeStore) {
    if (!options.bridgeAdminToken) {
      throw new Error("BRIDGE_ADMIN_TOKEN is required when bridge routes are enabled.");
    }
    app.use(
      "/bridge/v1",
      createBridgeIngressRateLimiter(options.bridgeStore, options.bridgeRateLimits),
      express.json({ limit: "64kb" }),
      createBridgeRouter(
        options.bridgeStore,
        bearerAuth(options.bridgeAdminToken),
        options.bridgeRateLimits,
      ),
      bridgeRateLimitErrorHandler,
    );
  }

  mcpApp.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "project-ambient-mcp",
      version: "0.1.0",
      adapter: options.adapterKind,
    });
  });

  mcpApp.get("/ready", bearerAuth(options.authToken), mcpAuthorizedRateLimit, async (_request, response) => {
    try {
      const status = await options.adapter.getStatus();
      response.json({ status: "ready", deviceOnline: status.online, adapter: options.adapterKind });
    } catch {
      response.status(503).json({ status: "not_ready", adapter: options.adapterKind });
    }
  });

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

  mcpApp.post("/mcp", bearerAuth(options.authToken), mcpAuthorizedRateLimit, (request, response) => {
    void handleMcpPost(request, response);
  });
  mcpApp.get("/mcp", bearerAuth(options.authToken), mcpAuthorizedRateLimit, (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode." },
      id: null,
    });
  });
  mcpApp.delete("/mcp", bearerAuth(options.authToken), mcpAuthorizedRateLimit, (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode." },
      id: null,
    });
  });

  app.use(mcpApp);
  app.use((error: unknown, request: Request, response: Response, next: (error?: unknown) => void) => {
    if (!(error instanceof BridgeRateLimitUnavailableError)) {
      next(error);
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({ error: "rate_limit_unavailable" });
  });
  return app;
}
