# Project Ambient MCP service

Project Ambient's AI control plane is a submission-ready, tool-only MCP server. It supports:

- local `stdio` for Claude Desktop, Codex, and other MCP clients;
- stateless Streamable HTTP at `/mcp` for hosted clients;
- a deterministic synthetic adapter for marketplace review;
- a strict `ambientctl` adapter for local control;
- an outbound-only device bridge for remote control without exposing localhost.

## Tool surface

Read-only tools: `get_status`, `list_channels`, `get_channel`, `get_history`.

Confirmed mutation tools: `next_wallpaper`, `activate_channel`, `pause_ambient`, `resume_ambient`, `set_power_policy`, `restore_previous`.

`get_history` reports recently applied local wallpaper assets; it is not an action log or a restore list. For compatibility the restore tool keeps its original name, but `restore_previous` specifically stops Ambient and restores the wallpapers that were active before Ambient first took control. It does not select an item from recent history.

Every mutation requires `confirmation: "confirmed"` and a fresh `request_id`. Repeating the same operation and inputs with the same request ID returns the same command; reusing it for different inputs is rejected. Inputs do not accept paths, URLs, shell fragments, media, or credentials.

Native idempotency is persisted by `ambientctl`, so a retry remains side-effect free across MCP process restarts. The current native response does not identify a persisted replay; consequently, `already_applied` is exact within a running adapter process, while the first response after an MCP restart may conservatively report `applied` for a command the native ledger already handled.

## Run locally

```sh
npm install
npm run build
AMBIENT_ADAPTER=demo npm start
```

The service starts at `http://127.0.0.1:8787`:

- `GET /health` — process health
- `GET /ready` — adapter readiness
- `POST /mcp` — MCP Streamable HTTP

For the installed Mac app, use `AMBIENT_ADAPTER=ambientctl` and set `AMBIENTCTL_PATH` if `ambientctl` is not on `PATH`. The adapter uses a fixed argument array with `execFile`; it never invokes a shell. Marketplace power modes map explicitly to the native companion: `still` → `efficiency`, `adaptive` → `automatic`, and `always_live` → `quality`. Ambient does not advertise a distinct “live only on AC” mode because the native engine cannot enforce one. Durations accepted in minutes by MCP are converted to seconds for the companion.

### Local MCP client / Claude Desktop

Build once, then adapt `claude-desktop.example.json` with the absolute path to `dist/src/stdio.js`. The stdio process defaults to the `ambientctl` adapter. An MCPB manifest and pack script are also included:

```sh
npm run pack:mcpb
```

The resulting `.mcpb` is not cryptographically signed. The alpha bundle is published with the GitHub release so local clients can install and inspect it.

## Hosted review and production

The default HTTP adapter is `demo`, which returns deterministic synthetic wallpaper data and is safe for reviewer testing. The authenticated alpha service is live at `https://project-ambient-control.vercel.app/mcp`. Every public or remote MCP service requires `MCP_AUTH_TOKEN` with at least 32 bytes and an explicit `MCP_ALLOWED_HOSTS` list. A public or remote bridge also requires an independent `BRIDGE_ADMIN_TOKEN` of at least 32 bytes.

```sh
docker build -t project-ambient-mcp .
# Run behind a proxy that overwrites X-Forwarded-For; use its actual narrow IP/CIDR.
docker run --read-only --tmpfs /tmp -p 8787:8787 \
  -e MCP_AUTH_TOKEN='<at-least-32-byte-random-token>' \
  -e MCP_ALLOWED_HOSTS='project-ambient-control.vercel.app' \
  -e BRIDGE_TRUSTED_PROXIES='<reverse-proxy-ip-or-cidr>' \
  -e POSTGRES_URL='postgresql://…?sslmode=require' \
  project-ambient-mcp
```

For public OpenAI submission, replace bearer auth with OAuth 2.1 + PKCE and complete `submission/checklist.md`. The stable HTTPS host and trust-policy URLs are already live.

### Deploy MCP and the remote bridge to Vercel

`api/index.ts` and `vercel.json` are ready for a Vercel deployment from this directory. The function keeps each MCP request within the 30-second function window. With `AMBIENT_ADAPTER=demo`, it exposes deterministic synthetic reviewer data. With `AMBIENT_ADAPTER=remote`, it routes tools to an enrolled Mac through a shared PostgreSQL command queue.

Before deploying any Vercel environment, provision PostgreSQL for the distributed request counters, then generate and add an MCP bearer token; never commit it. `POSTGRES_URL` is installed only by the fixed interactive bootstrap described below—not by a manual CLI upload:

```sh
openssl rand -base64 48
vercel env add MCP_AUTH_TOKEN production
# Run the credential-safe Supabase bootstrap below before building a deployment.
# Then deploy an unpromoted production-target artifact and smoke-test it first.
vercel --prod --skip-domain
```

For live device control on Vercel, add these additional production secrets/settings:

```text
AMBIENT_ADAPTER=remote
AMBIENT_DEVICE_ID=device_…
POSTGRES_URL=<installed only by the fixed bootstrap with sslmode=verify-full>
BRIDGE_ADMIN_TOKEN=<a second independently generated 48-byte secret>
```

The one-shot migrator creates and owns a hardcoded, non-exposed `ambient_private` schema. Normal web-service startup performs read-only verification: it requires the exact v4 migration ledger, relation/column/constraint/index layout, no leftover Ambient relations in `public`, and a least-privilege connected identity. Missing, outdated, future, malformed, or owner-connected schemas fail closed; runtime startup never issues `CREATE` or `ALTER`. The store leases commands transactionally with `FOR UPDATE SKIP LOCKED` and works across concurrent Vercel instances. The device endpoint is short-polling (a quick `204` when idle), so it does not consume a long-running function. The MCP-to-device result wait is bounded at 25 seconds, under the configured 30-second function limit.

The production service applies PostgreSQL-backed fixed-window limits before request-body parsing: 300 MCP requests per client IP per minute with 120 post-auth requests, 300 bridge requests per client IP per minute, 120 requests per authenticated administrator, plus separate quotas of 100 polls and 100 result posts per authenticated device. A normal 1.5-second agent uses about 40 polls per minute, leaving 60 poll slots and an independent result budget. Keys are separated into MCP ingress/authorized and bridge ingress/admin/poll/result scopes and one-way hashed; they never contain an authorization token. Each scope has a hard 50,000-active-key cap. Expired rows in a scope are fully reclaimed on the next new-key slow path; at capacity or on a bounded database lock/query failure, requests fail closed with a generic `503` and established counters are never evicted.

On Vercel, ingress identity comes only from a validated first IP in Vercel's platform-overwritten `x-vercel-forwarded-for`. A non-Vercel public/container deployment must set a narrow proxy IP/CIDR allowlist, for example `BRIDGE_TRUSTED_PROXIES=10.20.0.0/16,2001:db8:1234::/48`; catch-all `/0` ranges are rejected. The named proxy must overwrite, rather than append to, client-supplied `X-Forwarded-For`. Set `MCP_ALLOWED_HOSTS` to the exact public hostname(s); omitting it fails startup so the SDK Host/DNS-rebinding boundary cannot disappear accidentally. Local loopback development may omit these settings and ignores spoofed forwarding headers. JSON and memory profiles retain instance-local limiting only for loopback development; a public or remote service fails startup without PostgreSQL, minimum-length independent credentials, explicit proxy provenance, and allowed hosts. Provider/edge rate limiting remains defense in depth.

#### Credential-safe Supabase bootstrap library

`bootstrap:supabase` is dry-run by default. Without `--execute` it accepts no secrets, performs no network or database mutation, and prints only the fixed redacted topology:

```sh
npm run build
npm run bootstrap:supabase -- \
  --pooler-host aws-0-us-east-1.pooler.supabase.com
```

The live owner runner is explicitly interactive and fixed-target:

```sh
npm run bootstrap:supabase -- \
  --pooler-host aws-0-us-east-1.pooler.supabase.com \
  --credential jit \
  --execute
```

Before starting, the owner must create a dedicated, short-lived Vercel token using a trusted owner workflow and revoke it immediately after the ceremony. Code cannot prove the token's provenance, lifetime, or scope; preflight proves only that the presented token can access fixed project `prj_npI783AvPfO2DIuZEbwhL2CYt5Vn` in fixed team `team_m0flpJNmh3CYcXQcI82bKdsO`. The runner accepts neither token nor database credential through argv, environment variables, stdin pipes, Vercel CLI state, SDKs, curl, or a child process. It reads both secrets from a controlling TTY. It first proves that a complete environment listing contains no `POSTGRES_URL`. Only then does it display the target and require the exact visible phrase `project-ambient-control production POSTGRES_URL`; mismatch or cancellation stops before the database credential prompt, password generation, connection, or SQL.

The Supabase target is hardcoded to project `mbcxfyekqyexpqshamwq` in `us-east-1`; it accepts neither a project override nor another region. The library connects as `postgres.mbcxfyekqyexpqshamwq` through the TLS session pooler on port `5432` with JIT enabled when selected, generates 48 random bytes locally, derives a PostgreSQL `SCRAM-SHA-256` verifier, and creates the fixed `ambient_runtime` role with `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. It rejects an existing role instead of rotating it.

After the in-process migration, the library makes **three total** shared-pooler connection attempts: the initial attempt and at most two retries, each separated by 30 seconds. Only bounded connection/authentication errors that can represent post-create pooler propagation are retry candidates; some may also be permanent, so exhaustion stops without changing the role. It logs in as `ambient_runtime.mbcxfyekqyexpqshamwq` on port `6543`, verifies the exact identity and read-only schema initialization, and exercises bridge plus rate-limit privileges inside an always-rolled-back transaction. Identity, schema, and rollback-DML failures are never retried.

Only then is the generated canonical URL passed in memory to the fixed in-process HTTPS sink. The sink validates the exact role, host, port `6543`, database, 64-character base64url password, and sole `sslmode=verify-full` parameter. It performs a create-only Vercel API request for sensitive production `POSTGRES_URL`; it never uses `upsert`, so a collision between preflight and creation fails instead of overwriting. GET/preflight requests may retry bounded transient failures. Once the create request begins it is never replayed: a timeout or connection loss is ambiguous because Vercel may have committed it, and the runtime role is contained with `NOLOGIN`. Confirmation requires the documented HTTP `201` wrapper followed by an exact, complete metadata GET. The API never returns the sensitive value for comparison, so metadata confirms key/type/target, not value equality. There is intentionally no Vercel CLI/SDK/curl/child-process upload path.

If migration has committed or the sink has started, an error is an incident state: the library preserves `ambient_runtime` and attempts `ALTER ROLE ambient_runtime NOLOGIN`. A transport-ambiguous role creation or migration completion discards the failed session, acquires a fresh privileged client, verifies the exact `postgres` identity, and attempts only `NOLOGIN`; it never drops a role whose ownership is uncertain. Before migration starts, a definitely acknowledged newly-created role may be dropped; if that drop fails, `NOLOGIN` is attempted. Definite duplicate-role failures do not mutate the preexisting or concurrent role. JavaScript and network-buffer clearing is best effort.

**Post-commit recovery runbook (owner action):** do not rerun bootstrap or implicitly rotate/drop `ambient_runtime`. Keep bridge traffic disabled; determine whether the sink received the generated runtime URL; and inspect the role's flags/memberships, `ambient_private` grants, migration ledger, and any partial sink/deployment change. If the credential did not reach a sink, manually contain the role with `NOLOGIN` while preserving it for forensics. If it may have reached a sink, rotate the credential through a separately audited recovery procedure and update the confirmed sink before restoring login. In either case, repeat the exact port-6543 identity, store-readiness, and rollback-only smoke gates before re-enabling traffic. After every live JIT attempt: remove the `postgres` role mapping, disable Temporary Access when unused, and revoke the PAT.

#### Production bridge upgrade runbook

This is a server-first, maintenance-window rollout. Protocol-v1 agents must not be used after the migration; the server requires protocol v2 and the `lease_id` capability, and returns HTTP `426` before leasing any command to an incompatible agent.

1. Stop command producers and device agents. Take a database backup or provider snapshot and record its identifier. Before any migration, check the existing private layout for unexpected duplicate request IDs:

   ```sql
   SELECT device_id, COALESCE(request_id, operation ->> 'requestId') AS request_id, count(*)
   FROM "ambient_private"."ambient_bridge_commands"
   WHERE COALESCE(request_id, operation ->> 'requestId') IS NOT NULL
   GROUP BY 1, 2 HAVING count(*) > 1;
   ```

   For an alpha database that still has a complete legacy public layout, run the same read-only query against `"public"."ambient_bridge_commands"`. On a fresh database with neither relation, record that result and continue; do not create or rename anything by hand.

2. Build the release, then run the fixed interactive owner bootstrap above using short-lived Supabase Temporary Access and a dedicated short-lived Vercel token. Do not use the older manual password/SQL, standalone migrator, or CLI-upload path for this fixed Supabase production target:

   ```sh
   npm run build
   npm run bootstrap:supabase -- \
     --pooler-host aws-0-us-east-1.pooler.supabase.com \
     --credential jit \
     --execute
   ```

   The helper creates only the fixed `ambient_runtime` database-role identity while its in-process migrator creates the fixed `ambient_private` schema objects. It rejects `anon`, `authenticated`, `service_role`, `postgres`, and `pg_*`/`supabase_*` runtime identities through its topology and identity gates. The migrator holds a transaction-level lock, applies versions 1–4 atomically, revokes access from `PUBLIC` and Supabase exposed roles when present, and grants only exact runtime rights. It refuses newer/inconsistent ledgers and ambiguous public/private layouts. A complete legacy `public` layout is moved transactionally. It deletes no command rows; it terminally fails legacy leased commands rather than replaying ambiguous work, clears request identity from noncanonical duplicates, fails active rows whose stored request identifiers disagree or are invalid, and creates the distributed rate-counter table.
3. Verify the catalog and cleanup results before admitting traffic:

   ```sql
   SELECT version, name, applied_at FROM "ambient_private"."ambient_bridge_schema_migrations" ORDER BY version;
   SELECT indexdef FROM pg_indexes WHERE schemaname = 'ambient_private' AND indexname = 'ambient_bridge_commands_request_unique_idx';
   SELECT status, count(*) FROM "ambient_private"."ambient_bridge_commands" GROUP BY status ORDER BY status;
   SELECT id, error FROM "ambient_private"."ambient_bridge_commands"
   WHERE error LIKE '%during%upgrade%' ORDER BY created_at;
   ```

4. The bootstrap writes the confirmed `ambient_runtime` transaction-pooler URL to Vercel Production as sensitive `POSTGRES_URL`; it never installs the migration owner. Build a new production-target deployment without moving the canonical domain, then run the exact port-`6543` identity, store-readiness, and rollback-only transaction smoke gates against that deployment. Vercel environment changes affect only new deployments. Do not revoke Temporary Access or close the migration ceremony until the secret metadata is confirmed and the unpromoted deployment is healthy; immediately afterward remove the `postgres` mapping, disable Temporary Access, and revoke both short-lived tokens.
5. Promote that same verified deployment without rebuilding it. Deploy or restart the protocol-v2 Mac agent, confirm one lease/result round trip, then enable command producers and remote MCP traffic. Monitor `426`, migration, retry-exhaustion, and command-failure events.

Do not roll the server back to protocol v1 after the database migration. If validation fails, keep bridge traffic disabled, preserve the failed startup evidence, and restore the snapshot into a new database rather than editing the migration ledger by hand.

## Outbound device bridge

The bridge lets a public MCP service reach a user's Mac without exposing the Mac or its localhost server. The Mac polls an HTTPS endpoint with a per-device token, receives only typed operations from a fixed allowlist, invokes `ambientctl`, and posts the correlated result.

### 1. Enable the hosted bridge

For loopback-only development, set a separate admin token and a durable filesystem path on a persistent volume:

```sh
openssl rand -base64 48  # generate MCP_AUTH_TOKEN
openssl rand -base64 48  # generate a different BRIDGE_ADMIN_TOKEN
BRIDGE_ADMIN_TOKEN='<random admin token>' \
BRIDGE_STORE_PATH='/app/data/bridge-state.json' \
MCP_AUTH_TOKEN='<MCP client token>' \
AMBIENT_ADAPTER=demo \
npm start
```

Use at least 32 random bytes for each token, keep the MCP and bridge admin tokens different, and store both only in your host's encrypted secret manager.

The JSON store writes atomically with restrictive permissions and is appropriate only for a loopback, single-process development service. Public/container, Vercel, or horizontally scaled bridge deployments require `POSTGRES_URL` or `DATABASE_URL`; the built-in Postgres store takes precedence over the JSON path.

### 2. Enroll a Mac

Call the admin-only enrollment endpoint once:

```sh
curl -X POST https://your-bridge.example/bridge/v1/admin/devices/enroll \
  -H 'Authorization: Bearer <admin token>' \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"Luis’s Mac mini"}'
```

The response contains `device_id` and a one-time `device_token`. Store the token in the macOS Keychain or another user-scoped secret store; do not commit it.

### 3. Run the outbound Mac agent

```sh
AMBIENT_BRIDGE_URL='https://your-bridge.example' \
AMBIENT_DEVICE_ID='device_…' \
AMBIENT_DEVICE_TOKEN='amb_dev_…' \
AMBIENTCTL_PATH='/Applications/Project Ambient.app/Contents/Resources/ambientctl' \
npm run start:device
```

`AMBIENT_BRIDGE_URL` must use HTTPS. Only outbound HTTPS is required. The agent accepts no remote shell text and executes no arbitrary binary.

### 4. Route MCP through the enrolled Mac

Restart the hosted service with `AMBIENT_ADAPTER=remote` and the same durable store plus `AMBIENT_DEVICE_ID`. MCP calls enqueue a typed command and wait up to 25 seconds for the Mac's result; that caller may time out while its fenced command continues, and an idempotent mutation request retry retrieves the terminal result. Commands have a minimum/default TTL of 180 seconds and are leased for 120 seconds only when that full lease remains. This exceeds the explicit 98-second execution/delivery budget (8-second native execution, two 15-second result HTTP attempts, and a bounded 60-second `Retry-After`). A crashed agent therefore delays reassignment for at most 120 seconds; persisted lease fencing and native request IDs prevent stale or duplicate side effects.

Every lease is fenced by a unique lease ID and increments a persisted attempt counter. An expired lease can be retried up to three total attempts; after the third expiry the command is terminally failed rather than replayed indefinitely.

### Revoke a Mac

```sh
curl -X POST https://your-bridge.example/bridge/v1/admin/devices/device_…/revoke \
  -H 'Authorization: Bearer <admin token>'
```

Revocation invalidates future polls immediately. Rotate a device by revoking it and enrolling it again.

## Validation

```sh
npm run check
npm test
npm run build
npm run validate:registry
```

The test suite validates schemas and annotations, idempotent retries, confirmation enforcement, path rejection, HTTP auth and MCP transport, bridge enrollment/revocation, request-correlated remote results, migration contracts, protocol-v2 fencing, and bounded retry exhaustion. When `TEST_POSTGRES_URL` is set, its test-only credential needs `CREATEDB` and `CREATEROLE`; tests create randomly named disposable databases and runtime roles, never use production credentials, and clean up only their validated random names.

## Marketplace assets

- `submission/app-metadata.json` — OpenAI listing copy and trust URLs
- `submission/evals.json` — positive and negative review prompts
- `submission/checklist.md` — account and production gates
- `server.json` — production MCP Registry metadata for the GitHub namespace, npm package, and hosted endpoint
- `packaging/mcpb/manifest.json` — MCP Bundle/Claude Desktop metadata
- `claude-desktop.example.json` — manual local client configuration
