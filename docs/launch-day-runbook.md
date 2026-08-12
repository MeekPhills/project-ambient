# Launch-Day Runbook

## Before publishing

- Freeze the release commit and record its SHA.
- Run `./script/verify_release.sh` and the full release checklist.
- Publish the site and verify downloads, trust pages, mobile layout, and keyboard navigation.
- Publish the GitHub Release and project-owned Homebrew cask only after the immutable artifact is available.
- Open an announcement Discussion with known limitations and the diagnostic-report link.

## Initial message

Lead with the job, not the technology:

> Pick a folder. Choose a rule. Project Ambient brings up the right wallpaper at the right moment—without uploading your collection or continuously decoding motion behind your work.

State clearly that the release is alpha, static rendering uses public APIs, videos can be exported to Aerial, and the local AI control surface cannot be reached from a remote marketplace without an optional bridge.

## Live operations

- Keep one maintainer on installation and recovery reports and one on site/download health.
- Triage security, data loss, restore failure, black wallpaper, and rights complaints before feature requests.
- Acknowledge complete reports within two business days; never invent an ETA.
- Patch critical regressions immediately and update the changelog and checksums.
- Do not coordinate votes, mass-message communities, or ask users to bypass Gatekeeper.

## Stop-ship events

Pull the binary link while preserving source and incident notes if the release causes data loss, cannot restore a prior wallpaper, exposes local media remotely, contains a signing anomaly, or ships disputed media. Resume after root cause, fix, regression test, and a transparent postmortem.
