# Rights manifest contract

Version `1.0.0` separates software licensing from the evidence needed to display, reference, bundle, or sell media. Validate fixtures with:

```bash
node script/validate_rights.mjs
```

Validation is fail-closed:

- `private_reference` prohibits redistribution and commercial use and represents user-controlled media rather than a distributable media grant;
- `bundled_media` separately records Project Ambient's authority to reproduce/distribute and the end user's display/redistribution entitlement;
- `remote_reference` requires verified current provider terms, asset-linked provider evidence, approved origins, client-side retrieval, and a digest-bound source descriptor;
- commercial offers require verified review and Project Ambient commercialization authority while permitting personal-only end-user packs;
- every asset digest declares whether it binds immutable media bytes or a live-source descriptor, and every asset references specific review evidence;
- executable payloads and private file-path disclosure are prohibited;
- expired provider or asset terms are rejected;
- `conditional` grants require explicit conditions.

The positive fixtures include a paid personal-use creator pack and a private
enterprise reference to prove those grants do not imply customer redistribution
rights.

The manifest records evidence; it does not create rights. Qualified review remains required where the manifest says `counsel_required` or the intended use is not covered by the recorded evidence.
