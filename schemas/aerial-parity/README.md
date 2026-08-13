# Aerial semantic-parity contract

Version 1 freezes the launch coverage expected from Aerial 4.0.14 and 4.1.0beta13 as independently described behavior. It is not an implementation of Aerial, does not copy Aerial source or visual identity, and grants no tracker credit.

The canonical matrix is `docs/product/aerial-parity.json`. Every row is bound to an exact upstream version/commit, a Project Ambient owner and implementation task, a launch disposition, a test, and—where exact parity would be unsafe or unavailable—an explicit exception and user-facing alternative.

Run `node script/validate_aerial_parity.mjs`. Validation is fail-closed: all 19 product-spec domains and all three product directions must be represented; row IDs, evidence, tasks, issues, tests, owners, and exceptions must be complete; unknown fields and any score/weight/credit field are rejected. The all-row cross-cutting policy binds every capability to base-M4 resource conformance (#28) and direct/chat conformance or read-only explanation (#29). A `planned` row is a requirement only and must never be represented as shipped.

`node script/validate_aerial_parity.mjs --ga` is the future GA gate. It fails until the #28 base-M4 and #29 direct/chat all-row suites pass with durable evidence, every row is `verified`, every row test is `passed`, and each exception is `approved` with durable GitHub evidence. Stable GA tags run that strict mode; ordinary contract and prerelease work runs the planning-safe mode.
