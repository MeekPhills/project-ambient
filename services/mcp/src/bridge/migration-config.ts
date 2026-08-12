export interface BridgeMigrationConfig {
  connectionString: string;
  runtimeRole: string;
}

export function readBridgeMigrationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BridgeMigrationConfig {
  const connectionString = environment.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL is required for the one-shot bridge migration.");
  }
  const runtimeRole = environment.AMBIENT_RUNTIME_DB_ROLE;
  if (!runtimeRole) {
    throw new Error("AMBIENT_RUNTIME_DB_ROLE is required to provision least-privilege runtime access.");
  }
  let migrationUrl: URL;
  try {
    migrationUrl = new URL(connectionString);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (migrationUrl.protocol !== "postgresql:" && migrationUrl.protocol !== "postgres:") {
    throw new Error("MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (migrationUrl.port === "6543") {
    throw new Error(
      "MIGRATION_DATABASE_URL must use a direct/session connection, not transaction-pooler port 6543.",
    );
  }
  return { connectionString, runtimeRole };
}
