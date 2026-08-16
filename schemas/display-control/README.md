# Display-control capability register contract

Version 1 freezes the display-management coverage expected from BetterDisplay 4.3.6 (build 50119, released 2026-08-11, tag commit `046b59f8c04e8b46872ee270f5cee76cc1ef1803`) as independently described behavior. It is not an implementation of BetterDisplay, does not copy BetterDisplay source, assets, branding, or trade dress, and grants no tracker credit.

The canonical register is `docs/product/display-control-capability-register.json`. Every one of the 40 free-tier and 37 Pro-tier features on the official Free/Pro matrix is exactly one row, joined by cross-cutting program rows. Every row carries a comparator tier, immutable evidence reference, an API basis, an owning workstream (WS-DC-001 … WS-DC-011), a test binding, and one of five dispositions:

- **supported** — Supported Display Core; documented Apple APIs or pure app-local implementation only. A supported row may never carry an `os-undocumented` or `private-spi-risk` basis.
- **experimental** — optional, separately packaged, opt-in adapter (DDC, network device control, custom HiDPI, virtual displays, and similar). Adapter rows in hardware domains must gate on timeout, kill-switch, and hardware-matrix evidence.
- **manual-only** — documented manual procedure; no safe automation.
- **unavailable** — no safe implementation path currently exists.
- **blocked** — requires an explicit owner decision or is rejected by policy (EDID override, native/direct XDR, remote streaming, privileged helpers, shell escape hatches, unconfirmed automatic hardware changes).

Run `node script/validate_display_control.mjs`. Validation is fail-closed: the frozen baseline, domain list, tier counts, evidence catalog, disposition/basis rules, and safety gates are all enforced; unknown fields and any score/weight/credit field are rejected; and `launchGate.fullReplacementClaim` must remain `false` while any row is unqualified. The validator also runs thirteen tamper self-tests proving each rule actually rejects.

No public "full BetterDisplay replacement" claim may ship while the launch gate is false. BetterDisplay v5.0.2 remains a prerelease watchlist item, not the parity baseline.
