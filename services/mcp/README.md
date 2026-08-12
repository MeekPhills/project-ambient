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

The default HTTP adapter is `demo`, which returns deterministic synthetic wallpaper data and is safe for reviewer testing. The authenticated alpha service is live at `https://project-ambient-control.vercel.app/mcp`. Enable bearer authentication by setting `MCP_AUTH_TOKEN`. Set `MCP_ALLOWED_HOSTS` when binding to `0.0.0.0`.

```sh
docker build -t project-ambient-mcp .
docker run --read-only --tmpfs /tmp -p 8787:8787 \
  -e MCP_AUTH_TOKEN='<random token>' \
  -e MCP_ALLOWED_HOSTS='project-ambient-control.vercel.app' \
  project-ambient-mcp
```

For public OpenAI submission, replace bearer auth with OAuth 2.1 + PKCE and complete `submission/checklist.md`. The stable HTTPS host and trust-policy URLs are already live.

### Deploy MCP and the remote bridge to Vercel

`api/index.ts` and `vercel.json` are ready for a Vercel deployment from this directory. The function keeps each MCP request within the 30-second function window. With `AMBIENT_ADAPTER=demo`, it exposes deterministic synthetic reviewer data. With `AMBIENT_ADAPTER=remote`, it routes tools to an enrolled Mac through a shared PostgreSQL command queue.

Before deploying, generate and add a high-entropy MCP bearer token as a Vercel secret; never commit it:

```sh
openssl rand -base64 48
vercel env add MCP_AUTH_TOKEN production
vercel --prod
```

For live device control on Vercel, provision PostgreSQL and add these production secrets/settings:

```text
AMBIENT_ADAPTER=remote
AMBIENT_DEVICE_ID=device_…
POSTGRES_URL=postgresql://…?sslmode=require
BRIDGE_ADMIN_TOKEN=<a second independently generated 48-byte secret>
```

The Postgres store runs a versioned, advisory-locked schema migration before bridge routes are exposed, leases commands transactionally with `FOR UPDATE SKIP LOCKED`, and works across concurrent Vercel instances. Startup fails closed if migration validation fails or if the database schema is newer than this server. The device endpoint is short-polling (a quick `204` when idle), so it does not consume a long-running function. The MCP-to-device result wait is bounded at 25 seconds, under the configured 30-second function limit.

#### Production bridge upgrade runbook

This is a server-first, maintenance-window rollout. Protocol-v1 agents must not be used after the migration; the server requires protocol v2 and the `lease_id` capability, and returns HTTP `426` before leasing any command to an incompatible agent.

1. Stop command producers and device agents. Take a database backup or provider snapshot and record its identifier.
2. Check for unexpected duplicate request IDs:

   ```sql
   SELECT device_id, COALESCE(request_id, operation ->> 'requestId') AS request_id, count(*)
   FROM ambient_bridge_commands
   WHERE COALESCE(request_id, operation ->> 'requestId') IS NOT NULL
   GROUP BY 1, 2 HAVING count(*) > 1;
   ```

3. Build the release and run the one-shot migrator first against staging, then production, while bridge traffic remains blocked by maintenance mode or a network rule:

   ```sh
   npm run build
   POSTGRES_URL='postgresql://…?sslmode=require' npm run migrate:bridge
   ```

   The migrator holds a transaction-level lock, applies versions 1–3 atomically, and refuses a newer or inconsistent ledger. It deletes no rows. It terminally fails legacy leased commands rather than replaying ambiguous work, clears request identity from noncanonical duplicates, and fails active rows whose stored request identifiers disagree or are invalid.
4. Verify the catalog and cleanup results before admitting traffic:

   ```sql
   SELECT version, name, applied_at FROM ambient_bridge_schema_migrations ORDER BY version;
   SELECT indexdef FROM pg_indexes WHERE indexname = 'ambient_bridge_commands_request_unique_idx';
   SELECT status, count(*) FROM ambient_bridge_commands GROUP BY status ORDER BY status;
   SELECT id, error FROM ambient_bridge_commands
   WHERE error LIKE '%during%upgrade%' ORDER BY created_at;
   ```

5. Deploy or restart the protocol-v2 Mac agent, confirm one lease/result round trip, then enable command producers and remote MCP traffic. Monitor `426`, migration, retry-exhaustion, and command-failure events.

Do not roll the server back to protocol v1 after the database migration. If validation fails, keep bridge traffic disabled, preserve the failed startup evidence, and restore the snapshot into a new database rather than editing the migration ledger by hand.

## Outbound device bridge

The bridge lets a public MCP service reach a user's Mac without exposing the Mac or its localhost server. The Mac polls an HTTPS endpoint with a per-device token, receives only typed operations from a fixed allowlist, invokes `ambientctl`, and posts the correlated result.

### 1. Enable the hosted bridge

Set a separate admin token and a durable filesystem path on a persistent volume:

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

The JSON store writes atomically with restrictive permissions and is appropriate for a single service replica. For Vercel or horizontal scale, set `POSTGRES_URL` or `DATABASE_URL`; the built-in Postgres store takes precedence over the JSON path.

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

Restart the hosted service with `AMBIENT_ADAPTER=remote` and the same durable store plus `AMBIENT_DEVICE_ID`. MCP calls enqueue a typed command and wait for the Mac's result. Commands expire after 60 seconds and device leases expire after 30 seconds.

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

The test suite validates schemas and annotations, idempotent retries, confirmation enforcement, path rejection, HTTP auth and MCP transport, bridge enrollment/revocation, request-correlated remote results, migration contracts, protocol-v2 fencing, and bounded retry exhaustion. When `TEST_POSTGRES_URL` is set, it also runs isolated-schema integration tests against a real PostgreSQL server; those tests never use production credentials.

## Marketplace assets

- `submission/app-metadata.json` — OpenAI listing copy and trust URLs
- `submission/evals.json` — positive and negative review prompts
- `submission/checklist.md` — account and production gates
- `server.json` — production MCP Registry metadata for the GitHub namespace, npm package, and hosted endpoint
- `packaging/mcpb/manifest.json` — MCP Bundle/Claude Desktop metadata
- `claude-desktop.example.json` — manual local client configuration
