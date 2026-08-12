# Remote Device Bridge Deployment

The hosted MCP endpoint cannot reach `localhost` on a user’s Mac. Production remote control therefore uses an outbound device agent and a durable command queue.

## Components

1. The MCP host validates a bounded tool call and enqueues a typed command with a request ID and expiration.
2. The Mac device agent opens an outbound authenticated HTTPS session and requests work for its device ID.
3. The agent maps the typed operation to a fixed `ambientctl` argument array. It never evaluates shell input.
4. The agent returns a bounded result correlated to the request ID.
5. The MCP call returns the result, times out safely, or reports that the device is offline.

## Required production properties

- TLS on every external connection.
- A distinct hashed token per user/device and a separate administrative enrollment secret.
- Tokens shown once, revocable, rotatable, and never logged.
- Durable, transactional queue storage shared by every service instance.
- Command TTL, idempotency key, claim lease, attempt cap, and replay protection.
- One device may claim only commands addressed to it.
- Results contain no media, paths, filenames, thumbnails, prompts, or command-line strings.
- Deletion removes device tokens, queued work, results, and audit records within the published period.
- Rate limits by account, device, token, and IP; constant-time credential comparison.

## Deployment profiles

### Local and single-node evaluation

Use the filesystem store only on one trusted stateful host with a persistent volume. It is suitable for controlled evaluation, not horizontal production scaling.

### Vercel review deployment

Vercel can host the stateless MCP demo/review adapter. Its ephemeral filesystem and multi-instance execution are not a durable device queue. The reference service therefore fails closed when production bridge mode is requested without a durable store.

### Production bridge

Deploy the container to a stateful service and configure a durable Postgres or managed queue adapter. Keep the MCP web tier stateless. PostgreSQL state lives only in the hardcoded, non-exposed `ambient_private` schema; the runtime never creates or alters database objects.

Use two database identities:

- A migration owner, supplied only as `MIGRATION_DATABASE_URL` to the one-shot `npm run migrate:bridge` command. Load it from an encrypted secret manager without printing/pasting it. Use a direct or session-mode TLS URL (normally port `5432`), not transaction-pooler port `6543`, and never install this credential in Vercel or the running service. When using the shared Supavisor session pooler, the connection-string username is `<database-role>.<project-ref>`; the database role itself remains the bare name.
- A dedicated runtime login, supplied as `POSTGRES_URL` through the provider transaction pooler (Supabase/Supavisor port `6543`) with TLS, created with `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, no memberships, no object ownership, and no database/schema `CREATE`. With shared Supavisor, use `ambient_runtime.<project-ref>` as the connection-string username while keeping `AMBIENT_RUNTIME_DB_ROLE=ambient_runtime`. Percent-encode generated passwords in connection URIs. The Node client uses unnamed statements compatible with transaction pooling. Set its password through a secret-safe provider workflow rather than checked-in or shell-history SQL. Before promotion, the exact port-`6543` credential must authenticate with `current_user = session_user = 'ambient_runtime'` and pass runtime readiness plus bridge transaction smoke tests.

The one-shot migrator requires `AMBIENT_RUNTIME_DB_ROLE`, refuses Supabase exposed/reserved/elevated/member roles, revokes `PUBLIC`/`anon`/`authenticated`/`service_role` access, and installs this exact runtime matrix:

| Object | Runtime privileges |
|---|---|
| Database | `CONNECT` |
| `ambient_private` schema | `USAGE` |
| Migration ledger | `SELECT` |
| Devices and commands | `SELECT, INSERT, UPDATE` |
| Rate-limit counters | `SELECT, INSERT, UPDATE, DELETE` |
| Rate-limit state | `SELECT, UPDATE` |

Runtime startup read-only verifies the exact v4 ledger and private catalog, rejects Ambient objects left in `public`, and audits the connected identity and effective privileges. Missing, outdated, future, structurally altered, or owner-connected databases fail closed. Run the migration before traffic, require health/readiness probes, and alert on queue age, expired commands, authentication failures, duplicate claims, and result-post failures.

## Enrollment

1. The signed Mac app creates a device key locally.
2. The user starts “Link a device” from the authenticated service and receives a short-lived, one-use enrollment code.
3. The device exchanges that code over TLS and receives a scoped device token.
4. The service shows device name, creation time, last seen, and Revoke.
5. The device stores its token in Keychain, never UserDefaults or a recipe file.

The alpha’s command-line device agent is for technical evaluation. Broad release should wrap enrollment, Keychain storage, online/offline state, and revoke in the native UI before claiming consumer-ready remote control.
