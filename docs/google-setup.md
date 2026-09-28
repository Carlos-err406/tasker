# Google Drive setup (optional)

Tasker works offline without a Google account. Google Drive adds dated recovery snapshots; it does not sync or merge live tasks. You do not need a hosted server, domain, Apple developer membership, Supabase project, or paid Google storage plan. Stay within your account's available storage and the API's included usage. Do not enable billing or purchase quota for this project.

## What credentials means

This is the app's **Desktop OAuth client configuration**, created once by the developer in Google Cloud. It identifies Tasker to Google's authorization service. It is not your Google password or a service-account key. Users then connect their own Google accounts through the browser consent screen; they do not each need to create a Cloud project. Official release archives include Tasker’s public Desktop OAuth application configuration. Source checkouts keep the client values out of Git; release builds inject them from a maintainer-supplied file. End users do not need to download a JSON file. Account authorization tokens are never bundled.

## Consent-screen assets

The [local consent-screen kit](../assets/google-consent/README.md) includes the original Tasker artwork exported as a 120 px PNG, copy-ready branding and scope text, and a draft privacy notice. Public page URLs and a support email are not preconfigured.

## For users of the official app

Open **Backups → Connect Google**, sign in, and approve access. Your tasks are backed up to your own Drive and your grant stays in your Mac’s Keychain. Your Google account must be allowed by the project’s current audience settings; bundling does not change Testing/Production status or complete Google verification.

## Configuration precedence

1. `TASKER_GOOGLE_CLIENT_JSON`, when explicitly supplied to the service.
2. `google-client.json` in the configured Tasker data directory, if present.
3. The bundled default in the compiled service. The source module `apps/macos/src/google/public-client.ts` is an unconfigured placeholder.

An invalid or missing explicit override is an error, not a silent switch to a different OAuth app. Existing local overrides are preserved by installation. Keep a working override if it identifies a different client: changing OAuth client identity can require reconnecting and affect access to backups associated with the previous client.

The distributed configuration contains only the desktop `clientId` and optional `clientSecret`. Google treats installed applications as public clients that cannot keep a client secret confidential. These fields identify the app; they do not grant access to any account. Keep downloaded JSON and actual client values out of Git. Never add refresh/access tokens to the bundled module. See [Google’s installed-app guidance](https://developers.google.com/identity/protocols/oauth2/native-app).

## For developers: create your own free desktop client

1. Open [Google Cloud Console](https://console.cloud.google.com/) with your Google account. Create a project for Tasker. A Cloud project is a configuration container; Tasker deploys no cloud compute.
2. Enable **Google Drive API** under APIs & Services → Library.
3. In **Google Auth Platform**, configure the app's branding (Tasker), support email, audience (**External** for a personal Gmail account), and developer contact. While the app is in **Testing**, add your Google account as a test user.
4. Under Data Access, request only `https://www.googleapis.com/auth/drive.file`. This permits app-created/selected files; Tasker creates its own “Tasker backups” folder. Do not request full Drive access. Google classifies this scope as non-sensitive. See [Drive scope documentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
5. Under Clients, create an OAuth client with application type **Desktop app**, then download its JSON. A Web application client will not work. The app uses your browser, PKCE, and a temporary localhost callback. No domain or manually configured public redirect is needed. See [Google's desktop OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app).
6. Copy the downloaded file to:

   ```text
   ~/Library/Application Support/tasker-swiftbar/google-client.json
   ```

   Keep it out of Git. For a development service, set `TASKER_GOOGLE_CLIENT_JSON` to its absolute path instead. The installer uses the default filename inside its configured data directory.
7. Restart the service (`pnpm install:macos` from the repository), open **Backups → Connect Google**, choose your account in the browser, and allow the requested access. Return to SwiftBar after the success page.
8. Create a local backup and choose **Upload now**. A successful cloud timestamp is separate from local snapshot creation. **Browse Drive backups** lists restorable snapshots. Restore shows a replacement warning and creates a local safety snapshot first.

## Testing mode and reconnecting

For an External app in Testing, Google normally issues refresh tokens that expire after seven days for this Drive scope. Reconnect when prompted. For ongoing personal use, review the Auth Platform publishing requirements and move to Production when appropriate; no paid plan is required by Tasker. Publishing an OAuth consent configuration is separate from publishing this source repository. Do not add extra sensitive scopes just to remove a warning. See [Google's token-expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

Refresh tokens stay in macOS Keychain under `org.tasker-swiftbar.google`; access tokens remain in service memory. Neither is included in snapshots. **Disconnect** removes the local grant and stops uploads, leaving existing Drive files and local tasks intact. You can also revoke the app from your Google Account's third-party connections.

## Budget and limits

Checked 2026-09-27: Google documents included Drive API allowances, with future billing-policy changes announced separately. This personal backup workload is small, but free usage is not unlimited. Review [current Drive quotas and pricing thresholds](https://developers.google.com/workspace/drive/api/guides/limits) before distributing the app broadly. Keep this project unbilled and use only existing storage. Quota, permission, and network failures show an error and retry later; they never initiate a purchase or prevent local task editing.

Tasker currently limits a cloud snapshot to 512 MiB and an individual pasted image to 10 MiB. Local automatic retention is seven snapshots; manual and restore-safety snapshots are kept. The same automatic retention applies to completed app-created Drive snapshots. Backups are ordinary SQLite files, not end-to-end encrypted archives; protect your Google account and Mac.

## Release packaging

`TASKER_GOOGLE_BUILD_CLIENT_JSON=/absolute/path/to/desktop-client.json pnpm release:archive` builds the application and creates `release/tasker-swiftbar-<version>-macos.tar.gz`. The archive includes compiled application code (including the public OAuth default), the SwiftBar plugin, dependency manifests, and the installer. It excludes raw OAuth JSON, user databases, backups, runtime files, account tokens, and node_modules. Recipients install dependencies on their own Mac; this is not a standalone signed application. See [release instructions](releasing.md).

The build script validates the supplied Desktop JSON and writes only `clientId` and the optional desktop `clientSecret` to ignored `dist-service` output. The source stays unconfigured. A build without the environment variable clears any previously bundled identity; the archive command then fails rather than shipping a release without Google setup. Fork maintainers supply their own Desktop client file through that variable. A local runtime override remains useful for development without changing the distributed identity.

## Verification status

The user confirmed successful live Google consent, two uploaded Drive backups, and restoration on 2026-09-27. Automated tests additionally cover OAuth state/PKCE, denied consent, revoked-token errors, quota errors, upload deduplication, configuration precedence, and release exclusions. Live token refresh and revocation remain separate checks; successful upload/restore alone does not verify them.
