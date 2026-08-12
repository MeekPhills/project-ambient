# Distribution

Project Ambient uses separate artifacts for the native product and AI control surfaces.

## Native app

The direct Mac artifact must be built in Release mode, signed with a Developer ID Application certificate, hardened, notarized, stapled, zipped, checksummed, and verified with both `codesign` and `spctl` before publication. The Mac App Store is not required for launch; a future store build should stay within public APIs and App Sandbox constraints.

The Homebrew cask starts in the project-owned repository/tap. Replace its checksum only with the checksum from the immutable, notarized GitHub Release asset. Submit to the central Homebrew cask repository after the project has independently verifiable user interest.

## AI clients

- **Local MCP / Claude Desktop:** use the stdio server and packaged configuration in `services/mcp/marketplace`.
- **Claude directory:** package the local integration as an MCPB after validating it against Anthropic’s current submission rules.
- **OpenAI Plugins Directory:** deploy the Streamable HTTP server on stable HTTPS, verify the publisher and domain, connect it in Developer Mode, and submit its production `/mcp` endpoint with the prepared review fixtures.
- **Official MCP Registry:** publish only after the npm package or remote server is public. Registry metadata is immutable per version; run the security gate first.
- **Microsoft and Google:** use the included cross-marketplace metadata only after their certification/enterprise prerequisites are met.

An AI marketplace listing does not install the Mac binary. Every listing must say that the Project Ambient companion is required for actual desktop control.
