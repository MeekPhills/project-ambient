# Security Policy

## Supported versions

Security fixes are applied to the latest tagged release and the current default branch. Alpha builds may change quickly and should not be deployed to managed fleets.

## Report a vulnerability

Use GitHub’s **Private vulnerability reporting** feature for this repository. Do not open a public Issue for a suspected vulnerability. Include the affected version, reproduction steps, expected impact, and any proposed mitigation.

Maintainers aim to acknowledge a complete report within two business days, provide a triage decision within seven days, and coordinate disclosure after a fix is available. These are response targets, not guaranteed resolution dates.

## Security boundaries

- Local media stays local unless the user explicitly configures another service.
- MCP tools expose bounded wallpaper actions, not a shell or general filesystem access.
- HTTP deployments support bearer authentication and must use TLS in production.
- Tokens belong in platform secret stores, never source control or recipe files.
- Persistent mutations require explicit confirmation.
- Provider integrations must use allowlisted domains, bounded downloads, and provenance metadata.
- Release artifacts should be signed, notarized, checksummed, and accompanied by an SBOM before broad distribution.

See `services/mcp/marketplace/` for the MCP review threat model and test prompts.
