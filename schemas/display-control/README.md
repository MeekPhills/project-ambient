# Display-control capability register contract

Version 1 freezes the display-management coverage expected from BetterDisplay 4.3.6 (build 50119, released 2026-08-11, tag commit `046b59f8c04e8b46872ee270f5cee76cc1ef1803`) as independently described behavior. It is not an implementation of BetterDisplay, does not copy BetterDisplay source, assets, branding, or trade dress, and grants no tracker credit.

The canonical register is `docs/product/display-control-capability-register.json`. Every one of the 40 free-tier and 37 Pro-tier features on the official Free/Pro matrix is exactly one row, joined by cross-cutting program rows. Every row carries a comparator tier, immutable evidence reference, an API basis, an owning workstream (WS-DC-001 … WS-DC-011), a test binding, and one of five dispositions:

- **supported** — Supported Display Core; documented Apple APIs or pure app-local implementation only. A supported row may never carry an `os-undocumented` or `private-spi-risk` basis.
- **experimental** — optional, separately packaged, opt-in adapter (DDC, network device control, custom HiDPI, virtual displays, and similar). Adapter rows in hardware domains must gate on timeout, kill-switch, and hardware-matrix evidence.
- **manual-only** — documented manual procedure; no safe automation.
- **unavailable** — no safe implementation path currently exists.
- **blocked** — requires an explicit owner decision or is rejected by policy (EDID override, native/direct XDR, remote streaming, privileged helpers, shell escape hatches, unconfirmed automatic hardware changes).

## Immutable source pins

Every `evidenceCatalog` entry must carry a `pin` object with exactly one of three shapes:

- **git-commit** — `{ "type": "git-commit", "commit": <40-hex sha>, "immutableURI": <commit-addressed URL> }`. Used for wiki pages (pinned to one wiki snapshot commit), repository files (pinned to the frozen 4.3.6 tag commit `046b59f8c04e8b46872ee270f5cee76cc1ef1803`), the release tag, and MIT-licensed reference repositories.
- **content-hash** — `{ "type": "content-hash", "contentSha256": <64-hex sha256 of the raw retrieved body>, "retrievedAt": <ISO date> }`. Used for live pages with no commit history (GitHub discussions, Apple documentation). The hash is a point-in-time fingerprint of the exact bytes retrieved; nothing is normalized.
- **unpinnable-live** — `{ "type": "unpinnable-live", "reason": <explicit reason> }`. Used only when no commit exists and no content body could be retrieved (for example an internal handoff record, or a URI that returned a stable HTTP 404 at pin time). A hash is never invented.

## Source crosswalk contract

`docs/product/display-control-source-crosswalk.json` binds every register row to its pinned evidence, exactly once:

- The header binds `registerVersion` and the frozen BetterDisplay 4.3.6 `tagCommit`/`landingCommit` baseline.
- `entries` carries exactly one entry per register row — no missing, extra, or duplicate rows — with `rowId`, the row's `evidenceRefs` copied verbatim, `primaryEvidence` (the first reference), and `pinnedBy` mapping each reference to its resolved catalog pin summary (`git-commit:<sha>`, `content-hash:sha256:<hash>`, or `unpinnable-live`).
- `catalogUsage` records, for every catalog entry, how many rows cite it via `evidenceRefs`, how many cite it inside `apiBasis` references, and whether it is bound as the frozen baseline source. Every catalog entry must be used at least once; the validator recomputes this from the register and requires exact equality.

Run `node script/validate_display_control.mjs`. Validation is fail-closed: the frozen baseline, domain list, tier counts, evidence catalog, immutable pins, source crosswalk, disposition/basis rules, and safety gates are all enforced; unknown fields and any score/weight/credit field are rejected; and `launchGate.fullReplacementClaim` must remain `false` while any row is unqualified. A missing or unparsable crosswalk fails the run. The validator also runs twenty-three tamper self-tests proving each rule actually rejects, including dropped/duplicated crosswalk rows, crosswalk/evidence mismatches, malformed or missing pins, pin-summary drift, unused catalog entries, and crosswalk baseline or register-version drift.

No public "full BetterDisplay replacement" claim may ship while the launch gate is false. BetterDisplay v5.0.2 remains a prerelease watchlist item, not the parity baseline.
