export interface BridgeSecurityConfiguration {
  bridgeEnabled: boolean;
  publicOrRemote: boolean;
  mcpToken: string | undefined;
  adminToken: string | undefined;
}

export function validatePublicMcpAuthentication(
  publicOrRemote: boolean,
  mcpToken: string | undefined,
): void {
  if (publicOrRemote && !hasMinimumTokenLength(mcpToken)) {
    throw new Error("MCP_AUTH_TOKEN must contain at least 32 bytes for a public or remote MCP service.");
  }
}

function hasMinimumTokenLength(value: string | undefined): value is string {
  return value !== undefined && Buffer.byteLength(value) >= 32;
}

/** Fail closed before database initialization; never include credential values in errors. */
export function validateBridgeSecurityConfiguration(
  configuration: BridgeSecurityConfiguration,
): void {
  if (!configuration.bridgeEnabled || !configuration.publicOrRemote) return;
  if (!hasMinimumTokenLength(configuration.mcpToken)) {
    throw new Error("MCP_AUTH_TOKEN must contain at least 32 bytes for a public or remote bridge.");
  }
  if (!hasMinimumTokenLength(configuration.adminToken)) {
    throw new Error("BRIDGE_ADMIN_TOKEN must contain at least 32 bytes for a public or remote bridge.");
  }
  if (configuration.mcpToken === configuration.adminToken) {
    throw new Error("MCP_AUTH_TOKEN and BRIDGE_ADMIN_TOKEN must be independent credentials.");
  }
}
