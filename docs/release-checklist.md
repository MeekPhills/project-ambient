# Release Checklist

## Code and behavior

- [ ] Native build and tests pass on the minimum and current macOS versions.
- [ ] MCP TypeScript check, tests, positive prompts, and negative prompts pass.
- [ ] Public site builds and trust routes return 200.
- [ ] Folder import, apply, next, pause, resume, history, and restore work.
- [ ] VoiceOver, keyboard, Reduce Motion, and contrast checks pass.
- [ ] Sleep/wake and at least one display reconnect fixture pass.
- [ ] No private API, arbitrary command, silent source addition, or prohibited provider is present.

## Supply chain

- [ ] Lockfiles are committed and dependency audit is reviewed.
- [ ] Secret scan and CodeQL pass.
- [ ] SBOM and SHA-256 checksums are generated.
- [ ] Release notes list known limitations and migration impact.
- [ ] Source and binary versions match the tag.

## Apple distribution

- [ ] Bundle identifier, version, minimum system version, icon, and privacy declarations are correct.
- [ ] Release binary uses Hardened Runtime and Developer ID Application signing.
- [ ] Archive passes `codesign --verify --deep --strict --verbose=2`.
- [ ] Notarization returns Accepted and the ticket is stapled.
- [ ] `spctl --assess --type execute --verbose=4` accepts the staged app on a clean account.
- [ ] Download checksum matches the immutable release asset.
- [ ] Homebrew cask install, upgrade, uninstall, and zap are tested.

## Publication

- [ ] GitHub Release, site download, Homebrew cask, and marketplace metadata point to the same version.
- [ ] Privacy, terms, support, security, accessibility, and rights URLs are live.
- [ ] No listing implies that an AI marketplace installs or can directly reach the Mac companion.
- [ ] Maintainer is available for the first two hours and checks release health daily for one week.
