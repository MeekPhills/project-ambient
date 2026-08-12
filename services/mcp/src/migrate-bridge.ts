#!/usr/bin/env node
import { Pool } from "pg";
import { migratePostgresBridge, POSTGRES_BRIDGE_SCHEMA_VERSION } from "./bridge/postgres-migrations.js";

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL or DATABASE_URL is required for the bridge migration.");
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 8_000,
  application_name: "project-ambient-bridge-migration",
});

try {
  const client = await pool.connect();
  try {
    await migratePostgresBridge(client);
  } finally {
    client.release();
  }
  process.stdout.write(`Project Ambient bridge schema is at version ${POSTGRES_BRIDGE_SCHEMA_VERSION}.\n`);
} finally {
  await pool.end();
}
