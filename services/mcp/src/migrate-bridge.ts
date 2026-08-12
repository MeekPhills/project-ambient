#!/usr/bin/env node
import { Pool } from "pg";
import { migratePostgresBridge, POSTGRES_BRIDGE_SCHEMA_VERSION } from "./bridge/postgres-migrations.js";
import { readBridgeMigrationConfig } from "./bridge/migration-config.js";

const { connectionString, runtimeRole } = readBridgeMigrationConfig();

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 8_000,
  application_name: "project-ambient-bridge-migration",
});

try {
  const client = await pool.connect();
  try {
    await migratePostgresBridge(client, { runtimeRole });
  } finally {
    client.release();
  }
  process.stdout.write(`Project Ambient bridge schema is at version ${POSTGRES_BRIDGE_SCHEMA_VERSION}.\n`);
} finally {
  await pool.end();
}
