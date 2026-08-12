# Project Ambient Launch Copy

The public launch copy below is ready to use with live links and the verified alpha status. The two individual outreach templates retain only recipient-specific placeholders. Never ask for votes or instruct users to bypass Gatekeeper.

## GitHub release

### v0.1.0-alpha — your collection, alive at the right moment

Project Ambient is an open-source, local-first wallpaper orchestrator for macOS.

Pick a folder of photos and videos, let the Mac organize it into smart channels, and choose simple rules for when each channel should appear. The app always shows what is playing, what comes next, and why. Still images use public macOS APIs; videos can be exported to Aerial.

This alpha includes:

- Folder import and on-device organization.
- Explainable smart channels and deterministic rules.
- Now / Next / Why, next, pause, resume, history, and exact restore.
- Visible power modes and still-first behavior.
- Native SwiftUI UI plus `ambientctl`.
- Local and hosted MCP control with bounded, permission-annotated tools.
- Aerial-compatible video export.

Privacy is the default: no account for local use, no telemetry by default, and no media upload. Project Ambient does not bundle copyrighted sports footage or operate an upload marketplace.

Known alpha limitations:

- The Apple-silicon Mac build targets macOS 14+ and is not Developer ID-signed or notarized. Gatekeeper may block it; do not disable Gatekeeper or remove quarantine attributes. Building from source is the safer early-access path.
- Video playback is delegated to Aerial rather than a private wallpaper API.
- Hosted assistant control requires the optional authenticated device bridge.
- Reliability testing across every display topology is still growing.

Download: https://github.com/MeekPhills/project-ambient/releases/tag/v0.1.0-alpha
Documentation: https://github.com/MeekPhills/project-ambient
Security reports: use GitHub private vulnerability reporting.

Homebrew:

```sh
brew tap MeekPhills/tap
brew install --cask project-ambient
```

## Show HN

### Title

`Show HN: Project Ambient – local-first wallpaper automation for macOS`

### Post

I wanted my Mac’s background to behave more like a personal, contextual channel: beaches while working, city photos in the evening, or my own game-day memories at the right time. Existing tools are good at rendering, especially Aerial, but organizing a personal collection and explaining automation still felt manual.

Project Ambient is my open-source orchestration layer. It indexes a folder locally, builds editable smart channels, evaluates deterministic rules, and shows Now / Next / Why. It uses the public macOS desktop-image API for stills and exports videos to Aerial instead of relying on private wallpaper internals.

The repo also includes a CLI and a narrow MCP surface so local assistants can list and activate channels without receiving the media. Persistent changes require confirmation; there is no general shell or arbitrary filesystem tool.

The part I care most about is trust: exact restore, a still fallback, transparent power behavior, no account for local use, and no telemetry by default. The alpha is unsigned, Apple-silicon-only, and still growing its coverage across display topologies. I would especially value reports from people using multiple displays, docking, VoiceOver, or Low Power Mode.

https://github.com/MeekPhills/project-ambient

## r/MacApps

### Title

`[OS] Project Ambient — local-first smart wallpaper channels for macOS (free alpha)`

### Post

Problem: I had folders full of meaningful photos and videos, but wallpaper apps made me manually rebuild playlists and rarely explained why a particular item appeared.

Project Ambient points at a local folder, organizes it on-device, and lets you create rules such as “Shorelines on work mornings” or “use stills in Low Power Mode.” The main view shows Now, Next, and Why. Stills use public macOS APIs; video collections export to Aerial.

Comparison: this is not trying to replace Aerial’s renderer or become another wallpaper store. It is an open orchestration and automation layer for media you already own.

Pricing: free, MIT-licensed, no account for local use, no telemetry by default.

Alpha status: the Apple-silicon build requires macOS 14+ and is not Developer ID-signed or notarized. Gatekeeper may block it; please do not disable Gatekeeper or strip quarantine. Building from source is the safer route until the signed build lands. I’m looking for installation and recovery feedback, especially on multi-display Macs. Please don’t share private media in bug reports.

Install with Homebrew:

```sh
brew tap MeekPhills/tap
brew install --cask project-ambient
```

Source and direct download: https://github.com/MeekPhills/project-ambient/releases/tag/v0.1.0-alpha

## Product Hunt

### Name

Project Ambient

### Tagline

Private, power-aware wallpaper channels for your Mac.

### Short description

Turn your own photos and videos into explainable smart channels that react to time and power—without uploading your collection.

### Maker comment

I built Project Ambient because I wanted a background system that understood a personal library without turning it into a cloud feed.

The product starts with a folder on your Mac. On-device organization builds editable channels, deterministic rules select the right one, and Now / Next / Why makes every choice inspectable. Public macOS APIs handle stills, while Aerial remains an optional video renderer.

The core is open source and local use needs no account. Telemetry is off by default, media stays on the device, and accessibility, restore, security, and power controls are not paid features.

This is an alpha, so I’m here for real workflow and reliability feedback—not just launch-day attention. If you try it, I’d love to know what felt unclear and how it behaved after sleep, docking, or Low Power Mode.

## Individual Mac-media pitch

**Subject:** A local-first Mac utility turns personal media into explainable wallpaper channels

Hi [name],

I’m launching Project Ambient, an open-source macOS utility that organizes a user-selected photo/video folder into smart wallpaper channels and chooses among them with transparent time and power rules.

The distinction is that it does not try to replace Aerial’s renderer or build another media marketplace. Stills use public macOS APIs, videos can be handed to Aerial, and the interface always shows Now / Next / Why. Local use requires no account, media is not uploaded, and telemetry is off by default.

The story may fit your coverage of thoughtful Mac utilities: [one sentence tailored to the publication]. I can provide a review build, uncut demo, architecture note, energy methodology, privacy/security brief, and known-limitations list. No embargo or coverage expectation.

Project: https://project-ambient.meekphillies.chatgpt.site
Source: https://github.com/MeekPhills/project-ambient

Thank you,
[name]

## Creator compatibility outreach

**Subject:** Compatibility feedback on an open orchestration layer for Aerial media

Hi [creator],

I’m building Project Ambient, an open-source Mac companion that organizes user-owned media into contextual channels and exports video selections to Aerial. I’m not launching a competing pack store.

I would value your feedback on the channel manifest and attribution view. The goal is for a creator to keep control of the download/license endpoint, receive permanent in-app credit, and share a recipe without redistributing media. There is no exclusivity and no request for an endorsement.

If the approach fits your work, I’d be glad to prepare a private compatibility example using only media and terms you approve.

Project: https://project-ambient.meekphillies.chatgpt.site
Technical notes: https://github.com/MeekPhills/project-ambient

Best,
[name]
