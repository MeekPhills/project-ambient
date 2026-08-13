# Rights and Commercial Legal-Risk Register

**Date:** 2026-08-13
**Status:** Product risk assessment for counsel review; not legal advice
**Method:** Severity (1–5) × likelihood (1–5). Scores 1–4 low, 5–9 medium, 10–15 high, 16–25 critical.

| ID | Risk | Severity | Likelihood | Score | Level | Owner | Required mitigation and evidence | Escalation gate |
|---|---|---:|---:|---:|---|---|---|---|
| LR-01 | A pack redistributes media without sufficient rights | 5 | 3 | 15 | High | Rights maintainer | Fail-closed manifest, checksum binding, evidence references, human review, takedown/disable path | Counsel before bundled or paid media ships |
| LR-02 | Provider/API terms prohibit wallpaper use, caching, or redistribution | 4 | 4 | 16 | Critical | Provider owner | Terms URL and review date, allowed-action matrix, bounded cache, automated expiry/re-review, kill switch | Counsel before enabling provider; disable on material terms change |
| LR-03 | Sports marks, broadcasts, venues, or likenesses are treated as licensed because facts are public | 5 | 3 | 15 | High | Content owner | Separate factual metadata from expressive media; explicit rightsholder agreement; no broadcast scraping | Counsel/rightsholder approval before distribution or promotion |
| LR-04 | User media is uploaded, trained on, sold, or exposed beyond the user's instruction | 5 | 2 | 10 | High | Privacy owner | Local default, purpose-bound consent, no-training promise, data map, export/delete, redacted diagnostics | Privacy counsel before hosted sync/inference activation |
| LR-05 | Model weights or inference provider are used outside their license/terms | 4 | 3 | 12 | High | AI adapter owner | No bundled weights by default; per-model license record; provider terms/data-use disclosure; capability kill switch | Counsel before bundling or monetizing a model/provider |
| LR-06 | MIT Community work is silently moved behind a commercial boundary | 4 | 2 | 8 | Medium | Maintainers | Published boundary table, package ownership, architectural tests, public ADR for any change | Maintainer and counsel review before boundary changes |
| LR-07 | Contributor lacks authority or later disputes relicensing | 4 | 2 | 8 | Medium | Maintainers | Inbound=outbound MIT, DCO sign-off, no silent relicensing, contribution provenance | Counsel before CLA, dual licensing, or relicensing |
| LR-08 | Creator pack terms, payouts, taxes, refunds, or territories are misleading | 4 | 3 | 12 | High | Marketplace owner | Defer transactions; clear offer/license; payout and tax process; territory checks; audit trail | Counsel before payments or paid catalog launch |
| LR-09 | Privacy, publicity, or trademark rights are missing despite copyright permission | 4 | 3 | 12 | High | Rights reviewer | Separate review states and evidence; reject unknown commercial claims; complaint/disable process | Counsel for commercial or promotional use of identifiable people/marks |
| LR-10 | Takedown process mishandles notices, counter-notices, or evidence | 4 | 2 | 8 | Medium | Legal owner | Preserve evidence, authenticated intake, reversible disable, documented jurisdiction-specific workflow | Counsel before public marketplace operations |
| LR-11 | Apple/system content is copied or redistributed outside permitted platform behavior | 4 | 3 | 12 | High | macOS owner | Supported APIs only, no extraction/bundling, current terms review, exact capability disclosure | Counsel before shipping a system-media connector |
| LR-12 | Open-source dependencies introduce incompatible copyleft, source-available, patent, or notice obligations | 4 | 3 | 12 | High | Release owner | SBOM, license allowlist/denylist, notice generation, source-offer checks, release preflight | Counsel for non-allowlisted licenses or commercial distribution |
| LR-13 | “Self-hosted” chat implies privacy while an optional endpoint exports prompts/media context | 4 | 3 | 12 | High | AI/privacy owner | Local deterministic default, explicit endpoint and fields preview, no media/path/prompt diagnostics, per-request network indicator | Privacy/security review before external endpoint support |

## Monitoring cadence

- High and critical risks: review at each affected design, provider, pack, release, or terms change.
- Medium risks: review at every milestone gate and before commercial activation.
- Low risks: review at least annually or when scope changes.
- Provider and model terms evidence expires after the period declared in its manifest; expiration makes the source unavailable until re-reviewed.

## Residual-risk rule

Engineering controls can reduce likelihood but do not convert uncertain rights into permission. A high-impact ambiguity remains blocked until the designated owner records sufficient evidence or qualified counsel accepts the residual risk.
