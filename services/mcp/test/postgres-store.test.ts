import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PostgresBridgeStore } from "../src/bridge/postgres-store.js";

test("Postgres schema initialization retries after a transient failure", async () => {
  let schemaAttempts = 0;
  const pool = {
    async query(text: string) {
      if (text.includes("CREATE TABLE IF NOT EXISTS ambient_bridge_devices")) {
        schemaAttempts += 1;
        assert.match(text, /lease_id TEXT/);
        assert.match(text, /request_id TEXT/);
        if (schemaAttempts === 1) throw new Error("temporary database startup failure");
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT * FROM ambient_bridge_devices")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as unknown as Pool;
  const store = new PostgresBridgeStore({ connectionString: "postgresql://unused" }, pool);

  await assert.rejects(store.getDevice("device_test"), /temporary database startup failure/);
  assert.equal(await store.getDevice("device_test"), null);
  assert.equal(schemaAttempts, 2);
});
