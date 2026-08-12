# Apple Publisher Setup

The release script intentionally fails until the maintainer supplies publisher credentials. This prevents an unsigned artifact from being mistaken for a production release.

1. Join the Apple Developer Program and create a Developer ID Application certificate.
2. Store App Store Connect issuer ID, key ID, and private key through `xcrun notarytool store-credentials project-ambient` so the private key is kept in Keychain.
3. Set `AMBIENT_SIGN_IDENTITY` to the exact certificate identity and `AMBIENT_NOTARY_PROFILE=project-ambient`.
4. From the clean, matching tag, run `script/package_release.sh --tagged-release v<version> <version>`, then run `script/sign_and_notarize.sh` against `dist/release/<version>/Project-Ambient-<version>.zip`. The script preserves the original candidate as `-unsigned.zip`, signs the standalone `ambientctl` command as well as the app, promotes the notarized archive to the canonical filename only after local verification, and refreshes its checksum manifest.
5. Run `script/verify_release_artifacts.sh --require-homebrew dist/release/<version>` after updating the cask version and checksum from the promoted archive. This command itself requires notarization and matching tag provenance.
6. Test the final archive on a clean macOS account before replacing the website download or GitHub Release asset.

Never commit a certificate, `.p8` key, keychain password, Apple ID password, or notary profile secret.
