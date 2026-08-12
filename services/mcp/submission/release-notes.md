# Initial submission — Project Ambient 0.1.0

Project Ambient is a local-first, power-aware controller for a user’s existing Mac wallpaper collection. This initial MCP-only submission exposes ten narrow tools for inspecting status and channels, activating an existing channel, advancing, pausing or resuming rotation, selecting a power policy, reading recent wallpaper-asset history, and restoring the wallpapers that were active before Ambient took control.

The review environment uses deterministic synthetic data. It never exposes media bytes, local filesystem paths, private tags, or credentials. Mutating tools require explicit confirmation and an idempotency request ID. The public alpha endpoint currently uses bearer authentication; OAuth 2.1 with PKCE will replace it before public submission.
