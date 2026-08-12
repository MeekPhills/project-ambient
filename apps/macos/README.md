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

## Public API boundary

The app uses `NSWorkspace.setDesktopImageURL` for still backgrounds and does not call private WallpaperExtensionKit APIs. Local videos export as Aerial source folders with a machine-readable playlist manifest. This keeps the core app compatible with ordinary notarization and a future Mac App Store static-only build.
