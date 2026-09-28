# Google consent-screen assets

Prepared for Tasker on 2026-09-27. These files are local assets; nothing has been published or submitted to Google.

## Upload this logo

**`tasker-logo-120.png`** — 120 × 120 PNG, exported from the original Tasker desktop artwork without changing the design. Use this file in Google Auth Platform → Branding → App logo.

`tasker-original-1024.png` is the unchanged source artwork for future exports. It exceeds Google's 1 MB upload limit; upload the 120 px file instead. The existing SwiftBar menu-bar template icons are unchanged.

Google recommends a square 120 px logo and accepts PNG files up to 1 MB. Displaying custom branding for an external production app is subject to brand verification; uploading a logo does not itself publish or verify it. [Google branding requirements](https://support.google.com/cloud/answer/15549049?hl=en).

## Copy-ready material

- `consent-copy.md`: app name, description, scope justification, and the matching Console settings. Description and justification are reusable copy, not a claim that every Console screen has those fields.
- `privacy-notice.md`: privacy copy grounded in the current implementation. Before public use, review it as the app operator, add a direct support contact, and publish it at the privacy URL used in Console.

## Values to choose in Console

- **Support email:** select your monitored Google account address from the dropdown. Do not use a made-up support address.
- **Developer contact:** use an address you monitor for Google notices; it can be the same address.
- **Test users:** add each account that will test the app, including your own.
- **Public URLs:** no homepage, privacy URL, or terms URL has been created. Do not paste local file paths into Console. A public production submission needs appropriate hosted pages and domain verification; it is separate from personal testing and from creating a Desktop OAuth client. See [brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).

For the zero-budget MVP, continue with personal testing and the required Console fields. Do not buy a domain, enable billing, or publish this kit just to complete a local test. These assets do not guarantee OAuth approval or eliminate Google's verification requirements.

Follow [the setup guide](../../docs/google-setup.md) to create and install the Desktop OAuth client JSON. The downloaded JSON belongs outside this asset folder and outside Git.

## Provenance and regeneration

Source: `cli-tasker/apps/desktop/public/icon.png`. The source artwork is copied byte-for-byte; this kit does not alter or assert new rights to it. See [source provenance](../../docs/source-provenance.md).

On macOS, regenerate the upload export from the repository root:

```sh
sips -z 120 120 assets/google-consent/tasker-original-1024.png --out assets/google-consent/tasker-logo-120.png
```
