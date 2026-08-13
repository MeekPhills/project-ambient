# Project Ambient Roadmap

This roadmap uses the same M0–M8 terminology and order as GitHub milestones, the [accepted launch design](docs/product/FULL_PLATFORM_LAUNCH_SPEC.md), the [machine-checkable implementation plan](docs/product/implementation-plan.json), and the canonical status manifest. The implementation plan owns task dependencies, file areas, branches, acceptance criteria, and verification commands; this file is the human-readable sequence.

The product is progressively disclosed as **Static → Hybrid → Managed**. These are modes of one product, not separate editions. Work is ordered by user trust and recoverability, not feature count.

## Entry and merge rules

- M0 gates product implementation. No M1+ task starts until its M0 dependencies are accepted.
- One issue, owner, worktree, and branch owns each task. Parallel tasks cannot share mutable file areas without an explicit integrator.
- Every merge requires artifacts, focused tests, the defined smoke test, non-author review, risk/checkpoint updates, and an integration conflict check.
- Blocked, not-started, account-gated, submitted-but-unaccepted, and health-only work earns zero completion credit.
- The status manifest is the only weighted completion tracker. Milestone weights total 100.

## M0 — Governance and architecture (8 points)

Accept launch boundaries; verify the repository baseline; define licensing/media rights, capability contracts, and the Aerial parity matrix; publish the dependency plan; then pass a cold-start reconstruction smoke test.

Exit: a new agent using only the repository and GitHub can identify the exact milestone, issue, branch, files, dependencies, DoD, commands, blockers, owner, and next action without asking the maintainer.

## M1 — Static-first local product (14 points)

Ship the first vertical slice in strict order:

1. clean install and onboarding;
2. non-destructive local photo import with provenance;
3. horizontal/vertical display mapping with same-image and continuity modes;
4. exactly one rotation per lock and none on unlock/time/poll;
5. last-known-good restoration plus accessible Now / Next / Why.

Exit: two lock/unlock cycles change once per lock, preserve originals, keep both displays deterministic, use no continuous static renderer, and restore after an injected apply failure.

## M2 — Library, packs, and playlists (12 points)

Add image/video metadata, duplicate detection, rights manifests, signed/versioned creator packs, search, playlists, shuffle, loop, deterministic order, migrations, and offline export/import. Marketplace transactions remain deferred.

Exit: a mixed 100-file fixture containing duplicates and errors survives export, removal of only its test catalog, offline restore, and hash/provenance/playlist comparison.

## M3 — Complete macOS and Aerial parity (20 points)

Implement every permitted Aerial capability or record an exact legal/OS exception: personal media and sources, expansions, playlists, filters, wallpaper/screensaver/lock modes, displays, cache, schedules, solar time, shuffle/loop, transitions, overlays, playback, lifecycle pauses, accessibility, and diagnostics. Preserve semantic parity without copying implementation or UX.

Exit: no parity row is missing, unowned, untested, or unexplained; supported macOS/hardware/display matrices pass.

## M4 — Automation, energy, and quality (14 points)

Make lock/login/topology/power/thermal/camera/occlusion/network/FPS decisions deterministic and explainable. Select quality from resolution, codec, FPS, display refresh, decoder capability, and measured resources. Degrade live → video → static without blank or frozen transitions.

Exit: synthetic events and resource-pressure fixtures pass, privacy payloads are redacted, last-known-good survives failure, and a separate 48–72 hour clean-machine energy soak passes.

## M5 — Windows and Linux (12 points)

Run the bounded Rust feasibility spike without pre-authorizing a rewrite. Implement capability-equivalent adapters for Windows, GNOME Wayland, and KDE Plasma Wayland. Treat X11 as documented best-effort legacy unless evidence promotes it.

Exit: clean installs apply static and supported live content, reconnect displays, restart sessions, inject failure, restore, and report exact capabilities on every supported target.

## M6 — Mobile companions (7 points)

Version the device-control protocol, then ship iOS/iPadOS and Android companions for pairing, revocation, inspection, policy/content selection, idempotent actions, offline reconciliation, and conflict handling. Surface exact OS limitations.

Exit: pair/revoke/reconnect, duplicate/offline commands, conflicts, and payload/log privacy checks pass on both platform families.

## M7 — Managed commercial preview (6 points)

Ship a separately gated Managed Preview with two isolated tenants, roles, policy, audits, entitlement checks/revocation, an admin console, explicit SSO/SCIM limitations, community/hosted commercial boundaries, and support/security runbooks. The community core remains account-free.

Exit: two-tenant API/UI attack tests find no cross-tenant visibility; roles, policy, entitlement revocation, and audit export work. Enterprise GA remains gated by preview evidence.

## M8 — GA and distribution (7 points)

Unify source, tag, binary, SBOM, checksums, provenance, site, packages, updater, compatibility archive, support, incident response, and rollback. External stores/directories gain credit only after actual acceptance. Owner credentials and public launch remain explicit gates.

Exit: clean machines install, run, update, roll back, uninstall, and recover through every supported channel; all artifacts identify one exact commit/version; the canonical tracker reaches 100/100 under accepted scope.

## Deferred outside the weighted scope

- Microsoft enterprise distribution, unless the product decision changes.
- Google A2A, unless approved as a separate agent/commercial path.
- Marketplace catalog transactions and creator payouts before M2/M4 reliability.
- Enterprise GA before Managed Preview evidence.
- Legacy builds without vendor support or measured demand plus CI.
- An unrestricted upload marketplace, private macOS wallpaper-database edits, sports-broadcast scraping, unlicensed highlight distribution, arbitrary remote shell access, and generative wallpaper spam.
