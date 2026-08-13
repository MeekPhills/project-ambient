# Rights manifest contract

Version `1.0.0` separates software licensing from the evidence needed to display, reference, bundle, or sell media. Validate fixtures with:

```bash
node script/validate_rights.mjs
```

Validation is fail-closed:

- `private_reference` prohibits redistribution and commercial use and represents user-controlled media rather than a distributable media grant;
- `bundled_media` requires verified review, allowed redistribution, and no unknown/prohibited launch-critical grants or other-rights fields;
- `remote_reference` requires current provider terms, client-side retrieval, and no media redistribution grant;
- commercial offers require verified review, allowed commercial display/use, and no unresolved other-rights state;
- every asset digest declares whether it binds immutable media bytes or a live-source descriptor, and every asset references specific review evidence;
- executable payloads and private file-path disclosure are prohibited;
- expired provider or asset terms are rejected;
- `conditional` grants require explicit conditions.

The manifest records evidence; it does not create rights. Qualified review remains required where the manifest says `counsel_required` or the intended use is not covered by the recorded evidence.
