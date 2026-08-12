# Apple Publisher Setup

The release script intentionally fails until the maintainer supplies publisher credentials. This prevents an unsigned artifact from being mistaken for a production release.

1. Join the Apple Developer Program and create a Developer ID Application certificate.
2. Store App Store Connect issuer ID, key ID, and private key through `xcrun notarytool store-credentials project-ambient` so the private key is kept in Keychain.
3. Set `AMBIENT_SIGN_IDENTITY` to the exact certificate identity and `AMBIENT_NOTARY_PROFILE=project-ambient`.
4. Run `script/sign_and_notarize.sh` against the packaged release ZIP.
5. Test the final archive on a clean macOS account before replacing the website download or GitHub Release asset.

Never commit a certificate, `.p8` key, keychain password, Apple ID password, or notary profile secret.
