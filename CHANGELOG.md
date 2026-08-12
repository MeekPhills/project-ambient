# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning once the public API stabilizes.

## [0.1.0-alpha] - 2026-08-12

### Added

- Native macOS companion for local media, smart channels, deterministic rules, and public-API static wallpaper application.
- `ambientctl` local automation surface.
- Aerial-compatible video export.
- Tool-only MCP service with stdio and Streamable HTTP transports.
- Public launch site, trust documents, marketplace artifacts, release automation, and validation fixtures.

### Known limitations

- Binary distribution requires maintainer Apple signing and notarization credentials.
- Hosted AI control needs a separately deployed, authenticated outbound device bridge; remote MCP hosts cannot call a Mac’s localhost.
- The first renderer applies still images. Video playback is delegated to Aerial rather than a private macOS wallpaper API.
