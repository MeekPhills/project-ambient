# Project Ambient for macOS

Project Ambient is a local-first macOS background orchestrator. It scans folders you choose, classifies compatible media on-device, builds explainable smart channels, applies still images with public macOS APIs, and exports local video playlists for Aerial.

## Products

- `Ambient`: SwiftUI menu-bar and windowed app.
- `ambientctl`: JSON command-line surface used by local MCP integrations.
- `AmbientCore`: shared catalog, rules, persistence, wallpaper, recovery, and Aerial logic.

## Build and run

From the repository root:

```sh
./script/build_and_run.sh
```

The script builds both executables, stages `apps/macos/dist/Ambient.app`, bundles `ambientctl` in `Contents/Resources`, and opens the app. Use `--stage` to build the bundle without launching it and `--verify` to launch and confirm the process is alive.

The orbital icon is stored as SVG and ICNS in `Assets/`. `Tools/render_icon.swift` is the deterministic AppKit renderer used to reproduce the 1024-pixel source artwork before creating the ICNS iconset.

## Test

```sh
cd apps/macos
swift test --disable-sandbox
```

Project Ambient stores its state in `~/Library/Application Support/Project Ambient/state.json`. Tests and integrations can set `AMBIENT_DATA_DIR` to use an isolated location.

## Import, provenance, and rollback

Importing is an explicit copy-or-reference choice (`File > Import Background Folder…`, the dashboard import button, or `ambientctl import <folder> [--mode copy|reference] [--manifest photo-manifest.tsv] [--request-id <id>] --json`). Every imported asset records provenance — source path, SHA-256, byte count, and modification date — and originals are never altered in either mode. Copy mode duplicates supported media into Ambient's private library; reference mode leaves files in place. A failed import rolls back any copies it created, and typed `.importMedia` commands are idempotent per request ID across restarts, so a crashed or repeated import cannot double-ingest. Duplicate, unsupported, unreadable, and unmatched-attribution inputs are skipped with per-file actionable messages instead of failing the whole import.

### Attribution sidecar

If the selected folder contains `photo-manifest.tsv`, Ambient reads it automatically; `ambientctl` can point to another file with `--manifest`. The header must include `filename` and `license`, with optional `creator` and `source URL` columns. Values are recorded declarations, not legal interpretation: `Public Domain`/`CC0` maps to the explicit public-domain basis; other declared licenses map to the attributed-license basis and remain fail-closed for redistribution/commercial clearance. Unmatched manifest rows appear in the import report. A credit line is shown wherever an imported asset declares attribution is required and names a creator.

## Accessibility

The dashboard's Now / Next / Why card exposes a single combined VoiceOver element whose value narrates the applied background, channel, upcoming still, the "why" explanation, and the effective power mode. Each completed import posts an assistive-technology announcement summarizing the result (failures surface through the standard error alert), and the import report card — shown on the dashboard, or on the onboarding screen when an import added nothing — lists skipped files with their reasons as combined, focusable elements, a spoken summary element, and an explicitly labeled dismiss control. Reports longer than 50 items are truncated on screen with an explicit count. Core menu commands carry keyboard shortcuts (import Cmd-Shift-O, next background Cmd-Right, pause/resume Cmd-Shift-P). The spoken summaries are plain API (`AmbientImportReport.accessibleSummary`, `AmbientNowNext.accessibleSummary`) covered by unit tests.

## Public API boundary

The app uses `NSWorkspace.setDesktopImageURL` for still backgrounds and does not call private WallpaperExtensionKit APIs. Local videos export as Aerial source folders with a machine-readable playlist manifest. This keeps the core app compatible with ordinary notarization and a future Mac App Store static-only build.
