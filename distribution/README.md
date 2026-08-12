# Distribution

Project Ambient uses separate artifacts for the native product and AI control surfaces.

## Native app

The direct Mac artifact must be built in Release mode for both Apple Silicon and Intel, signed with a Developer ID Application certificate, hardened, notarized, stapled, zipped, checksummed, and verified with both `codesign` and `spctl` before publication. `script/package_release.sh --candidate` creates a clean-checkout, version-scoped CI candidate; a publishable artifact must instead be built with `--tagged-release v<version>` from the matching immutable tag. `script/sign_and_notarize.sh` only accepts that tagged candidate, signs both the app and distributed `ambientctl` command, and replaces the candidate's canonical archive only after Gatekeeper verification passes. The Mac App Store is not required for launch; a future store build should stay within public APIs and App Sandbox constraints.

The Homebrew cask starts in the project-owned repository/tap. The checked-in `0.1.0-alpha` cask describes the published alpha and must not be pointed at a new candidate. `script/package_release.sh` defaults to the source metadata's `0.1.0` because all current package, registry, and MCPB metadata use that version; it explicitly reports the alpha-versus-candidate distinction. Replace the cask version and checksum only with those from the immutable, notarized GitHub Release asset, then run `script/verify_release_artifacts.sh --require-homebrew dist/release/<version>` before publication. That command requires a notarized artifact from the matching immutable tag and rejects an architecture restriction when the release artifact is universal. Submit to the central Homebrew cask repository after the project has independently verifiable user interest.

## AI clients

- **Local MCP / Claude Desktop:** use the stdio server and packaged configuration in `services/mcp/marketplace`.
- **Claude directory:** package the local integration as an MCPB after validating it against Anthropic’s current submission rules.
- **OpenAI Plugins Directory:** deploy the Streamable HTTP server on stable HTTPS, verify the publisher and domain, connect it in Developer Mode, and submit its production `/mcp` endpoint with the prepared review fixtures.
- **Official MCP Registry:** publish only after the npm package or remote server is public. Registry metadata is immutable per version; run the security gate first.
- **Microsoft and Google:** use the included cross-marketplace metadata only after their certification/enterprise prerequisites are met.

An AI marketplace listing does not install the Mac binary. Every listing must say that the Project Ambient companion is required for actual desktop control.
