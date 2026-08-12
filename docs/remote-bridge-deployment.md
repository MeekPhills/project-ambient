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

Deploy the container to a stateful service and configure a durable Postgres or managed queue adapter. Keep the MCP web tier stateless. Run database migrations before traffic, require health/readiness probes, and alert on queue age, expired commands, authentication failures, duplicate claims, and result-post failures.

## Enrollment

1. The signed Mac app creates a device key locally.
2. The user starts “Link a device” from the authenticated service and receives a short-lived, one-use enrollment code.
3. The device exchanges that code over TLS and receives a scoped device token.
4. The service shows device name, creation time, last seen, and Revoke.
5. The device stores its token in Keychain, never UserDefaults or a recipe file.

The alpha’s command-line device agent is for technical evaluation. Broad release should wrap enrollment, Keychain storage, online/offline state, and revoke in the native UI before claiming consumer-ready remote control.
