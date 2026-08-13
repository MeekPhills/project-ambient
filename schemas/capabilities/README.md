# Project Ambient capability contract

`v1/capability-manifest.schema.json` is the language-neutral contract for a
specific Project Ambient build on a specific platform target. A platform name
never implies support: every capability ID is present exactly once with an
explicit state, user-facing explanation, and evidence link.

## Versioning and readers

- `schemaVersion` is the contract major version. Readers in this repository
  accept version `1` only and reject unknown major versions without guessing.
- `manifestVersion` is the SemVer version of a particular manifest document.
- Additive vocabulary changes require a new schema file and compatibility test.
  Removing or changing a field or state requires a new major schema version.
- Contract examples set `claimScope` to `contract_fixture`; they exercise the
  schema and do not advertise shipped support. Release manifests must use
  `shipped_build` and evidence the exact artifact they describe.

## Support states

- `supported`: verified for the named build and platform target.
- `experimental`: available with named limitations and a fallback.
- `unavailable_by_os`: the operating system or integration surface prevents it.
- `unavailable_by_build`: the platform could support it, but this build does not.
- `archived`: previously shipped, now outside active support; the last supported
  build and security status are mandatory.

## Release binding

Every manifest declares one of two release bindings:

1. `embedded` — the manifest is stored at a relative path inside the release
   asset; or
2. `linked` — the release metadata points to an immutable HTTPS manifest URL and
   pins its SHA-256 digest.

This is the M0 contract. M8 release packaging must embed or link the validated
manifest and verify the binding before publication; a prepared fixture does not
claim that an existing release has already been repackaged.

Run `node script/validate_capabilities.mjs` to validate the schema, all five
platform fixtures, release bindings, state-specific evidence, and negative
compatibility cases.
