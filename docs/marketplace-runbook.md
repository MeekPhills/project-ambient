# Marketplace Runbook

The native app and AI listings are separate deliverables. Publish the signed/notarized Mac app independently; list the AI control surface only where it can honestly connect to that companion.

## OpenAI Plugins Directory

1. Deploy the Streamable HTTP server at stable HTTPS `/mcp`; do not submit a tunnel or localhost URL.
2. Require production authentication for real devices and keep the deterministic review adapter isolated from user accounts.
3. Verify tool names, descriptions, schemas, impact annotations, retry behavior, and confirmation requirements.
4. Run the five positive and three negative fixtures in `services/mcp/marketplace/openai/`.
5. Connect the production endpoint in Developer Mode and refresh after metadata changes.
6. Verify organization/publisher identity and the production domain, then submit with live privacy, terms, support, and security URLs.

Current official guidance: [build an MCP server](https://developers.openai.com/plugins/build/mcp-server), [define tools](https://developers.openai.com/plugins/plan/tools), [submit and publish](https://developers.openai.com/plugins/deploy/submission), and [plugin guidelines](https://developers.openai.com/plugins/app-guidelines).

## Anthropic / Claude

Use stdio or an MCPB to control the installed companion without a cloud bridge. Validate the package on a clean user account and make installation/removal explicit. Submit the local listing under the current directory process; include that macOS companion installation is required.

## MCP Registry

Publish `server.json` only after its package or remote endpoint is public, security-reviewed, and versioned. Registry metadata is a discovery record, not binary hosting. Published version metadata is immutable, so never publish a placeholder URL, secret, or unreviewed version.

## Microsoft and Google

Use Microsoft’s MCP certification path through Partner Center only after the production remote service is stable. Google’s enterprise agent marketplace is appropriate only with an enterprise A2A use case and its partner prerequisites; custom MCP compatibility alone is not a public consumer listing.

## Store truth table

| Surface | Installs Mac app | Local-only works | Needs public MCP | Publisher gate |
| --- | --- | --- | --- | --- |
| GitHub / Homebrew | Yes | Yes | No | Apple signing for smooth install |
| Claude local MCPB | No | Yes | No | Anthropic review for listing |
| OpenAI Plugins | No | No | Yes | Verified publisher/domain + review |
| MCP Registry | No | Package or remote | For remote listing | Namespace/package verification |
| Microsoft | No | Usually no | Yes | Partner certification |
| Google enterprise | No | No | Enterprise service | Marketplace partner prerequisites |
