# Contributing to Project Ambient

Thank you for helping make macOS ambience more private, reliable, and understandable.

## Before opening code

1. Search existing issues and Discussions.
2. Use a Discussion for open-ended ideas; use an Issue for a reproducible defect or accepted unit of work.
3. For a new provider, include the provider’s API terms and content-license implications.
4. For a new media pack or recipe, document creator, source, license, redistribution rights, checksum, and AI-origin declaration.

## Local checks

```bash
swift test --package-path apps/macos
cd services/mcp && npm ci && npm run check && npm test
cd apps/site && npm ci && npm run build
```

Run `./script/verify_release.sh` before opening a release-related pull request.
Run `node script/validate_rights.mjs` for media-pack, provider, rights, or commercial-boundary changes.

## Pull-request expectations

- Keep one behavior change per pull request.
- Add tests for rules, permissions, restore behavior, and MCP schemas.
- Include VoiceOver names for interactive controls and verify keyboard access.
- Respect Reduce Motion and do not rely on motion alone to communicate state.
- Do not add telemetry, remote uploads, private macOS APIs, arbitrary command execution, or silent downloads.
- Describe energy implications for any continuous timer, media decode, background task, or polling loop.
- Never include media unless its redistribution rights are documented.

## Contributor ladder

Documentation and metadata changes are excellent first contributions. From there, contributors can own recipes, adapters, test matrices, or a subsystem. Maintainers are selected based on sustained, careful work and community conduct—not volume alone.

## Developer Certificate of Origin

Community contributions use inbound-equals-outbound MIT and must include a
`Signed-off-by: Name <email>` trailer certifying the
[Developer Certificate of Origin 1.1](DCO.txt). Sign off with `git commit -s`.
This is not a copyright assignment
and does not grant rights in third-party media.

By contributing and signing off, you agree that your contribution is licensed
under the repository's MIT License and certify that you have the right to make
the contribution. Any future CLA or relicensing proposal requires a separate
public decision and qualified legal review.
