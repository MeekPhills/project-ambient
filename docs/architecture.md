# Architecture

Project Ambient separates orchestration, rendering, and remote control so each permission boundary is visible.

## Native companion

`AmbientCore` owns the persisted catalog, channels, rules, decision history, power policy, and renderer protocol. The SwiftUI executable renders this state and obtains user intent. `ambientctl` invokes the same core contract for automation and local MCP clients.

The alpha renderer calls the public AppKit desktop-image API. Before the first apply it captures the current per-screen wallpaper so Restore can return the machine to its prior state. Video assets are not decoded by Project Ambient; the Aerial adapter copies or references user-selected files only after an explicit action.

## Local MCP

The stdio server launches a bounded `ambientctl` command for one declared intent. It never accepts shell fragments. Inputs are validated against fixed schemas and arguments are passed as a process argument array. Read-only status and listing tools do not require confirmation. Persistent mutations require a `confirmed` flag and carry a request ID for retries.

## Hosted MCP

The HTTP service exposes Streamable HTTP on `/mcp` and a minimal `/health` route. Bearer authentication can be required through deployment secrets. The deterministic demo adapter exists solely for marketplace review and automated evaluation; it does not imply control of a real Mac.

Real remote control requires a device agent to establish an outbound authenticated session. The server should enqueue a bounded command, the device should validate it again, and results should be correlated by request ID. Do not expose a Mac listener to the public internet or attempt to call `localhost` from a remote AI host.

## Data boundaries

Local state may include paths and filenames because the user selected those files. Hosted state must not include them. A hosted command references opaque channel and device IDs only. Remote logs may contain tool name, coarse result, latency, request ID, and redacted error class; they must not contain media or prompt bodies by default.

## Reliability

Every apply is a state transition:

```text
idle → deciding → preparing → applying → verifying → active
                   ↘ failed → restore-last-known-good → degraded-still
```

The renderer should record the reason for each transition, coalesce duplicate events, and make retries idempotent. A crash or display change must never leave a black background when a last-known-good still exists.
