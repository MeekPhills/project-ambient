# Project Ambient Privacy Policy

**Effective date: August 12, 2026**

Project Ambient is designed for local use. The open-source Mac companion does not require an account and does not collect telemetry by default.

## Local data

The companion stores its settings, channel definitions, rule history, and media index in the user’s Application Support directory. Imported media remains in the location the user selected. The app may read basic file and visual metadata to organize that media on the device.

The local app does not send media, thumbnails, file paths, filenames, prompts, content hashes, calendar event titles, or wallpaper history to Project Ambient maintainers.

## Optional services

If a user chooses to deploy or connect the hosted MCP service, that operator may process authentication identifiers, tool inputs, result status, timestamps, latency, and coarse error codes. The reference service is designed not to receive wallpaper files or local filesystem paths. A deployment operator must publish its own policy, retention period, and contact information before serving other users.

Third-party providers and renderers are governed by their own policies. Project Ambient shows provenance and makes integrations opt-in; it does not control those services.

## Diagnostics

Diagnostic exports are created only on request. Review an export before sharing it. Reports should redact personal paths and media names.

## Deletion

Local data can be removed from the app’s Reset controls or by deleting its Application Support directory after quitting. Hosted-service users should contact that deployment’s operator for account deletion. The reference design targets deletion within 30 days and short operational-log retention.

## Children and sale of data

Project Ambient is not directed to children under 13. The project does not sell personal data or use it for targeted advertising.

## Changes

Material changes will be documented in the repository and dated here. This policy is a product-policy template and is not legal advice; a deploying organization should have counsel review it for its jurisdiction.
