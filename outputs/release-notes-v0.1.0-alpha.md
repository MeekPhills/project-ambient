# Project Ambient 0.1.0-alpha

Project Ambient turns a folder of media you already own into private, explainable wallpaper channels for macOS.

This first alpha ships a native SwiftUI companion, on-device folder classification, smart and custom channels, scheduled rules, Now / Next / Why, public-API still wallpaper application, exact restore, visible power policies, Aerial-compatible video export, `ambientctl`, and local/hosted MCP control.

## Choose the right download

- **`Project-Ambient-0.1.0-alpha.zip`** — Apple-silicon Mac app plus `ambientctl`.
- **`Project-Ambient-Control-0.1.0-alpha.mcpb`** — local Claude/MCP bundle.
- **`meekphills-project-ambient-mcp-0.1.0.tgz`** — portable Node MCP package.
- **`Project-Ambient-Marketplace-Kit-0.1.0-alpha.zip`** — review metadata, evals, registry manifest, and distribution templates.
- **`SHA256SUMS.txt`** — integrity checksums for every artifact.

## Important signing notice

The Mac ZIP is **unsigned and not notarized** because this release environment does not have an Apple Developer ID identity. macOS Gatekeeper may block it. Do not disable Gatekeeper or remove quarantine attributes. For early access, review the source and build locally with `./script/build_and_run.sh`; a signed/notarized artifact will replace the alpha ZIP after publisher credentials are configured.

The staged unsigned bundle was inspected and is arm64-only, targets macOS 14+, contains the branded icon and bundled CLI, and intentionally uses only public AppKit wallpaper APIs. The release workflow is ready to strip development entitlements, sign nested code with Hardened Runtime, notarize, staple, and re-assess once credentials exist.

## Validation

- Native build: passed.
- Native unit tests: 7/7 passed.
- Isolated import/classification/CLI/Aerial smoke test: passed.
- MCP build and contract tests: 9/9 passed.
- MCP dependency audit: 0 known vulnerabilities.
- MCP Registry contract and MCPB manifest: passed.
- Site production build and rendered-route tests: 7/7 passed.
- Release checksums: verified.
- Secret-pattern scan: no matches.

## Known limitations

- Apple silicon only in this alpha.
- The app renders still images; it explicitly exports videos to Aerial instead of using private macOS wallpaper APIs.
- The hosted remote bridge requires a durable Postgres queue, per-device enrollment, and OAuth 2.1 before public OpenAI directory submission.
- Marketplace listings install the control surface, not the Mac companion.
- Broader multi-display, sleep/wake, and accessibility field testing continues in public.

Please use GitHub Discussions for setup and recipes, Issues for reproducible bugs, and private vulnerability reporting for security or sensitive rights reports. Never attach personal media, filesystem paths, or secrets.
