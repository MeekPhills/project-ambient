# Project Ambient — Live Launch Status

Updated: August 12, 2026 (America/New_York)

Project Ambient launched immediately as requested. No two-week validation gate was added.

## Live surfaces

| Surface | Status | URL |
|---|---|---|
| Product and trust site | Public, production, verified | https://project-ambient.meekphillies.chatgpt.site |
| Open-source repository | Public; Issues, Discussions, and private vulnerability reporting enabled | https://github.com/MeekPhills/project-ambient |
| Alpha release | Public prerelease with Mac app, source, MCPB, npm tarball, marketplace kit, and checksums | https://github.com/MeekPhills/project-ambient/releases/tag/v0.1.0-alpha |
| Homebrew tap | Public cask tap | https://github.com/MeekPhills/homebrew-tap |
| Launch announcement | Public GitHub Discussion | https://github.com/MeekPhills/project-ambient/discussions/1 |
| Hosted MCP reviewer service | Production, authenticated, deterministic demo adapter | https://project-ambient-control.vercel.app |
| MCP health endpoint | Public health response | https://project-ambient-control.vercel.app/health |
| Main-branch CI | Passing | https://github.com/MeekPhills/project-ambient/actions |

## Install and download

Homebrew alpha:

```sh
brew tap MeekPhills/tap
brew install --cask project-ambient
```

Direct downloads:

- Mac app and `ambientctl`: https://github.com/MeekPhills/project-ambient/releases/download/v0.1.0-alpha/Project-Ambient-0.1.0-alpha.zip
- Source snapshot: https://github.com/MeekPhills/project-ambient/releases/download/v0.1.0-alpha/Project-Ambient-0.1.0-alpha-source.zip
- Claude/local MCP bundle: https://github.com/MeekPhills/project-ambient/releases/download/v0.1.0-alpha/Project-Ambient-Control-0.1.0-alpha.mcpb
- AI marketplace kit: https://github.com/MeekPhills/project-ambient/releases/download/v0.1.0-alpha/Project-Ambient-Marketplace-Kit-0.1.0-alpha.zip
- Portable Node package: https://github.com/MeekPhills/project-ambient/releases/download/v0.1.0-alpha/meekphills-project-ambient-mcp-0.1.0.tgz
- Checksums: https://github.com/MeekPhills/project-ambient/releases/download/v0.1.0-alpha/SHA256SUMS.txt

## Verified evidence

- Native Swift build passed.
- Native unit tests passed: 7/7.
- Isolated import, classification, CLI request-ID, power-policy, and Aerial export smoke test passed.
- MCP contract and bridge tests passed: 9/9.
- MCP dependency audit reported 0 known vulnerabilities.
- Production MCP health check returned 200.
- Unauthenticated MCP initialize returned 401.
- Authenticated MCP initialize returned 200 with protocol `2025-03-26`.
- Authenticated `tools/list` returned all 10 permission-annotated tools.
- Site production build and rendered-route tests passed: 7/7.
- Public site rendered successfully in desktop and mobile Chromium viewports.
- Latest GitHub CI and CodeQL runs passed.
- Release checksums were regenerated after the live URLs and Homebrew cask were finalized, then verified locally and matched by GitHub asset digests.
- Secret-pattern scan found no committed secret.

## Important alpha boundaries

The downloadable Mac build is Apple-silicon-only, targets macOS 14+, and is not Developer ID-signed or notarized. Gatekeeper may block it. Users should not disable Gatekeeper or remove quarantine attributes; building from source is the safer path until Apple publisher credentials are connected.

The hosted MCP endpoint is a deterministic reviewer service behind a high-entropy bearer secret. It does not control a real Mac. Real remote control is implemented but intentionally remains disabled until durable PostgreSQL storage, per-device enrollment, and user-facing OAuth authorization are connected. The bearer secret is stored in Vercel only and is not committed or included in launch artifacts.

AI marketplaces distribute the control surface, not the Mac binary. The Mac app remains a GitHub/Homebrew download.

## Remaining publisher-account gates

These are not engineering omissions; each requires an external identity, verified organization, credential, or product choice that was not available in the workspace.

| Gate | What is already ready | Required owner input |
|---|---|---|
| Apple signing/notarization | Hardened signing, notarization, stapling, and assessment script | Developer ID Application identity and notarytool profile |
| npm publication | Publish-ready package and tarball | npm login with rights to `@meekphills` |
| OpenAI public directory | Live MCP URL, policies, metadata, evals, tool annotations | Publisher console access plus OAuth 2.1 identity/authorization deployment |
| Anthropic directory | Valid local MCPB and manifest | Directory submission/interest form under the publisher account |
| Microsoft certification | Stable endpoint, source, policies, eval evidence | Verified Partner Center publisher, Microsoft 365/Copilot enrollment, submission package choices |
| Google Cloud Marketplace | Technical core and policies | Cloud Marketplace vendor onboarding and a separate A2A/commercial-agent product decision |

No Reddit, Hacker News, Product Hunt, press, or creator messages were posted from an account the owner did not provide. Launch-ready copy is included in `launch-copy.md` for those channels.

## Release integrity

The canonical integrity file is the release asset `SHA256SUMS.txt`. The unsigned Mac ZIP hash at launch is:

```text
2298999e838d3c24241cdb3c57ff4e9fb5f6adb5963bd6d1998ec7d52883b2eb  Project-Ambient-0.1.0-alpha.zip
```
