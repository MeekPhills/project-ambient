# Content Rights and Provenance Policy

Project Ambient indexes media the user controls. It does not treat access to a file, feed, webpage, API, operating-system asset, or model output as permission to redistribute or monetize that material.

This is a product policy, not legal advice. Distributable or paid content and novel provider integrations require qualified review appropriate to the content, territory, and business model.

## Delivery classes

Every asset or source declares one delivery class:

- **Private reference:** user-controlled local media. It may be indexed and displayed for the user's configured purpose, but Project Ambient does not acquire publishing, training, sale, or redistribution rights.
- **Bundled media:** bytes distributed in a pack. Each asset requires evidence that redistribution and the pack's commercial/noncommercial use are allowed.
- **Remote reference:** a supported client fetches from a canonical provider. The manifest must record current terms, permitted actions, cache limits, attribution, review date, and expiry. Referencing remote bytes is not a workaround for prohibited use.

## Required manifest evidence

Versioned manifests under `schemas/rights/` record:

- creator, rightsholder, canonical source, acquisition date, and content checksum;
- human-made, AI-generated, mixed, or unknown provenance and any relevant tool/model identifier;
- license name, identifier, URL, evidence references, and review status;
- display, reproduction, redistribution, commercial use, modification/derivatives, synchronization, and sublicensing grants;
- required attribution, notices, share-alike terms, territory, term/expiry, audience, and field-of-use restrictions;
- copyright, privacy, publicity, trademark, and other-rights review states;
- takedown contact and a reversible disable path.

A manifest records evidence; it cannot create rights that a submitter does not hold. Missing or contradictory fields fail closed. “Unknown” is not sufficient for bundled, paid, promotional, or commercial use.

## Special categories

- **Sports:** schedules, scores, standings, and other facts do not license footage, photographs, broadcasts, logos, uniforms, venues, or athlete likenesses. Distributed sports media requires explicit rights or a defensible public-domain/open-license basis.
- **Apple/system media:** use only supported platform behavior and permissions. Do not extract, bundle, or redistribute system assets merely because the OS can display them.
- **Live feeds and APIs:** record the provider's current terms and permitted-use matrix. Do not bypass access controls, scrape prohibited sources, or cache longer than allowed.
- **AI output and model weights:** model output receives no presumption of clean title. Record provenance and review third-party rights. Model licenses and provider terms remain separate from the media manifest.
- **People, brands, and places:** copyright permission does not resolve privacy, publicity, trademark, endorsement, property, or venue restrictions; those reviews are separate fields.

## User media and optional services

Local files remain local by default. Optional sync or inference must preview the exact data classes and destination, use the minimum purpose-bound permission, and support revocation, export, and deletion. Project Ambient does not use user media, filenames, paths, prompts, or precise location to train models or sell advertising.

## Packs and creator economics

Before installation, a pack shows its creator/rightsholder, price if any, provenance, license, attribution, permitted uses, update policy, and takedown status. Paid placement may not influence ranking. Payments and catalog transactions remain deferred until the local library and M4 reliability gates pass and qualified review approves the terms.

## Reports and takedowns

Rights reports should identify the asset/pack, claimed right, evidence, and a secure contact method. Maintainers may reversibly disable disputed material while preserving records. Formal notice, counter-notice, retention, and jurisdiction-specific procedures require counsel before marketplace launch.

See `docs/decisions/0002-commercial-rights.md` and `docs/legal/rights-risk-register.md` for the software/commercial boundary and escalation model.
