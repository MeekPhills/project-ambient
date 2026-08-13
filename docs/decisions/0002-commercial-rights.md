# ADR 0002: Community, Commercial, Model, and Media-Rights Boundaries

- **Status:** Proposed for issue #21 review
- **Date:** 2026-08-13
- **Decision owners:** Project Ambient maintainers
- **Legal review:** Required before commercial launch; this record is product policy, not legal advice

## Context

Project Ambient combines open-source software, user-controlled media, optional creator packs, third-party feeds, model/provider adapters, hosted operations, and enterprise management. A software license cannot grant rights in photographs, video, broadcasts, logos, likenesses, model weights, or API content. The product therefore needs explicit boundaries that preserve a useful account-free Community edition without making unsupported redistribution or commercial-use claims.

## Decision

### 1. Community core remains MIT

The local catalog, import/reference pipeline, metadata and duplicate tools, rules and policy engine, renderer and platform adapters, playlists and packs, display continuity, lifecycle and energy controls, recovery, accessibility, diagnostics, CLI/App Intents/MCP contracts, deterministic in-app chat, and self-hosted-provider adapters remain in the MIT-licensed Community core.

Local operation does not require an account. Privacy, security fixes, restore, accessibility, provenance, and power-saving features may not be paywalled. A source build may not be intentionally degraded to force hosted adoption.

### 2. Hosted and managed products are separate services

Paid products may include hosted encrypted sync, managed-fleet administration, SSO/SCIM, organization policy, longer hosted audit retention, service-level commitments, enterprise deployment assistance, commercial support, and separately licensed creator content. They must use published, versioned contracts to interoperate with the Community core.

Genuinely service-specific control-plane code or managed modules may use a separate commercial license and repository/package boundary. They may not reclassify an existing MIT component merely because it becomes valuable. Community operation must continue without a hosted account.

### 3. Media rights remain independent

The repository's MIT license applies to code and repository-authored documentation, not to third-party or user media. Every distributable pack and every provider recipe must carry a versioned rights manifest. A manifest is evidence and policy metadata; it does not create rights that the submitter does not hold.

User-selected local media receives only the narrow permission necessary for on-device indexing, derivative generation, display, backup, export, or optional sync that the user explicitly enabled. Project Ambient does not receive a default right to publish, sell, train on, or redistribute it.

### 4. Packs, live sources, and platform media use least-authority delivery

- `bundled_media` requires explicit redistribution rights for every asset.
- `remote_reference` leaves media with the rightsholder/provider and requires current terms/API evidence; it is not a workaround for prohibited redistribution.
- `private_reference` describes user-controlled media and may not be published as a pack containing the media.
- Apple/system media is used only through supported platform behavior or user-controlled references when the applicable terms permit it; Project Ambient does not copy or redistribute Apple assets merely because the OS can display them.
- Sports schedules, scores, and factual metadata do not license photographs, highlights, broadcasts, logos, uniforms, venues, or likenesses.
- Scraping or bypassing access controls is outside the accepted product scope.

### 5. Models and chat providers are independently licensed and sandboxed

The deterministic offline intent parser and typed command bus are Community core. Optional OS-provided models are capability-gated. Optional self-hosted or hosted providers require an explicit adapter, separate provider/model license and terms review, and a visible resource/privacy disclosure.

Project Ambient does not bundle third-party model weights without verified redistribution and commercial-use rights. Model output cannot grant media rights and cannot mutate settings directly; all output passes the typed intent, preview, policy, verification, and undo path. User prompts, media metadata, precise location, paths, filenames, and credentials are excluded from diagnostics and model training by Project Ambient unless a later, separately consented feature and reviewed agreement explicitly say otherwise.

### 6. Contributions use inbound-equals-outbound plus DCO

Contributions to MIT components are accepted under MIT on an inbound-equals-outbound basis. The project will use Developer Certificate of Origin 1.1 sign-off rather than a broad copyright-assignment CLA for Community contributions. A future CLA, dual license, or relicensing program requires a new public decision, contributor impact analysis, and qualified legal review; existing contributions cannot be silently relicensed.

Contributors may submit only code, documentation, fixtures, and media metadata they are authorized to contribute. A DCO sign-off does not replace a media-rights manifest.

### 7. Creator economics are transparent

Creator packs may be free or separately paid. The product must show price, creator/rightsholder, license, attribution, AI provenance, permitted uses, update/takedown status, and whether a purchase grants personal or commercial display rights before installation. Project Ambient will not accept pay-to-rank placement or imply ownership of creator media.

Marketplace payments and catalog transactions remain deferred until local-library and M4 reliability gates pass. Payment, tax, consumer-protection, app-store, territory, and payout terms require qualified review before activation.

## Commercial boundary table

| Capability | Community MIT | Optional paid/managed boundary |
|---|---|---|
| Local static, hybrid, live runtime | Complete | No required paid dependency |
| Local library, packs, playlists, provenance | Complete | Separately licensed media may be sold |
| Energy, recovery, accessibility, privacy, security | Complete | Fleet-wide policy/reporting may be managed |
| Deterministic in-app chat and self-hosted adapter | Complete | Hosted inference or organization controls may be paid |
| Local diagnostics and 30-day-or-less local history | Complete | Hosted retention/support may be paid and configurable |
| Pairing and local remote control | Complete where OS permits | Managed device inventory/policy may be paid |
| Source code and local build | Available without account | Signing, hosted operation, and SLA are services |

## Legal-risk register

The detailed register is maintained in `docs/legal/rights-risk-register.md`. Highest launch risks are unlicensed media redistribution, provider/API terms drift, privacy/publicity/trademark claims, model-weight licensing, and ambiguity between Community and commercial modules. High-risk rows require senior or outside counsel before the triggering feature ships.

## Consequences

- Every pack/provider importer needs fail-closed rights validation.
- Library UI must distinguish local/private use from redistributable pack content.
- Optional hosted sync and inference require explicit consent, data-flow disclosure, deletion/export, and independent terms.
- Commercial packages need clear source/package boundaries and dependency inventories.
- The project can monetize services and licensed content without withholding essential local capability.

## Counsel-required gates

Qualified counsel must review, at minimum, the DCO implementation, trademark policy, creator and enterprise terms, DMCA/takedown process, hosted data terms, model/provider terms, payment/payout structure, consumer disclosures, international territories, and any proposed dual-license or source-available module before public commercial activation.
