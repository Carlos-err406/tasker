# Preparing a macOS release archive

From the repository root, run:

```sh
pnpm typecheck
pnpm test
TASKER_GOOGLE_BUILD_CLIENT_JSON=/absolute/path/to/desktop-client.json pnpm release:archive
pnpm test:e2e
```

The output is `release/tasker-swiftbar-<package version>-macos.tar.gz` plus its `.sha256` checksum. The version comes from the root package.json. This command prepares a local archive; it does not tag Git, upload anything, or change Google's publishing settings.

## Included application identity

`apps/macos/src/google/public-client.ts` is an unconfigured placeholder. After TypeScript compilation, the build script reads `TASKER_GOOGLE_BUILD_CLIENT_JSON`, validates a Desktop OAuth client, and writes only its public app identity fields to the ignored compiled service module. No actual client values are committed to Git. The archive contains that compiled configuration; no recipient has to create a Google project or install a JSON file. The current identity matches the client used for the user-confirmed Google backup/restore test.

Do not substitute a service-account key, a Web application secret, or user access/refresh tokens. The only distributed fields are the Desktop client ID and optional desktop client secret. Forks should supply their own app identity before distribution. A build without this input removes stale bundled configuration, and the release archive command rejects an unconfigured build. Local development overrides are documented in [Google setup](google-setup.md).

Google's audience/publishing/branding configuration still governs who can authorize the app. Do not advertise unrestricted access while the project is limited to test users. Source redistribution rights remain a separate prerequisite, as described in [source provenance](source-provenance.md).

## Archive contents

The packager uses explicit file and directory inputs: compiled core and service code, compiled web assets, tray plugin and icons, the installer, and the workspace dependency manifests. It excludes raw client JSON, account-token JSON, environment files, databases, snapshots, runtime files, symlinks, and installed dependencies. It never reads the app's data directory or Keychain.

## Recipient installation

Use the supported SwiftBar host, including the clipboard keyboard-routing fix, and install Node.js and pnpm 10.14.0. Extract the archive to a permanent directory, then run:

```sh
pnpm install --frozen-lockfile
pnpm install:macos
```

The service runs from that directory. Keep it and its dependencies in place. Native SQLite dependencies install for the recipient's Mac. The archive is a prebuilt Node/SwiftBar runtime, not a signed standalone `.app`; it contains no source-build setup.

Open Tasker → Backups → Connect Google. The browser asks for the user's own account authorization. The existing installer's local data directory and local JSON override are preserved when updating an installation.

## Publishing for the curl installer

Publish a GitHub release tagged `v<package version>` in `Carlos-err406/tasker`, attaching the archive and its `.sha256` companion. The installer resolves the latest release once, then downloads both assets from that exact tag. Keep published release assets immutable; publish a new version for later updates.

The first release `v0.1.0` also carries the pinned `SwiftBar-headerless-universal.zip` companion artifact and its license. Preserve that asset for future installers, which use its known SHA-256 rather than an unversioned host download. See `THIRD-PARTY-NOTICES.md` for source/build provenance. The installer itself is served from the repository's `main/install.sh`.
