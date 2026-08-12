import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBridgeSecurityConfiguration,
  validatePublicMcpAuthentication,
} from "../src/bridge/security-config.js";

const mcpToken = "m".repeat(32);
const adminToken = "a".repeat(32);

test("public or remote bridge requires strong independent MCP and admin credentials", () => {
  assert.doesNotThrow(() => validateBridgeSecurityConfiguration({
    bridgeEnabled: true,
    publicOrRemote: true,
    mcpToken,
    adminToken,
  }));
  for (const configuration of [
    { mcpToken: undefined, adminToken },
    { mcpToken: "short", adminToken },
    { mcpToken, adminToken: undefined },
    { mcpToken, adminToken: "short" },
  ]) {
    assert.throws(() => validateBridgeSecurityConfiguration({
      bridgeEnabled: true,
      publicOrRemote: true,
      ...configuration,
    }), /at least 32 bytes/);
  }
  assert.throws(() => validateBridgeSecurityConfiguration({
    bridgeEnabled: true,
    publicOrRemote: true,
    mcpToken,
    adminToken: mcpToken,
  }), /independent credentials/);
});

test("loopback development and disabled bridges retain their narrow exceptions", () => {
  assert.doesNotThrow(() => validateBridgeSecurityConfiguration({
    bridgeEnabled: true,
    publicOrRemote: false,
    mcpToken: undefined,
    adminToken: "local-admin",
  }));
  assert.doesNotThrow(() => validateBridgeSecurityConfiguration({
    bridgeEnabled: false,
    publicOrRemote: true,
    mcpToken: undefined,
    adminToken: undefined,
  }));
});

test("every public or remote MCP service requires a minimum-length bearer token", () => {
  assert.doesNotThrow(() => validatePublicMcpAuthentication(true, mcpToken));
  assert.doesNotThrow(() => validatePublicMcpAuthentication(false, undefined));
  assert.throws(() => validatePublicMcpAuthentication(true, undefined), /at least 32 bytes/);
  assert.throws(() => validatePublicMcpAuthentication(true, "short"), /at least 32 bytes/);
});
