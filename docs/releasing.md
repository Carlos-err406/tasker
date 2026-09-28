# Releasing Tasker

## Automated releases

`.github/workflows/release.yml` checks pull requests, pushes to `main`, and version tags on standard `macos-15` runners. It installs pinned Node.js/pnpm, verifies package/plugin versions and release notes, checks the shell installer, builds, typechecks, and runs unit and WebKit tests. The public repository uses free standard GitHub-hosted runners. Browser installation alone uses Node 24.19.0 because Playwright 1.58.2 stalls extracting its WebKit archive under Node 26; tests switch back to Node 26.8.1.

To release:

1. Bump the version in the root package.json, the three workspace package.json files, and the plugin's `<xbar.version>` field.
2. Add `docs/releases/<version>.md` with user-facing changes and installation instructions. Open and merge the PR after checks pass.
3. From an up-to-date, clean `main` checkout, push the matching tag, for example:

   ```sh
   git tag v0.1.2
   git push origin v0.1.2
   ```

A tag must exactly match the package version and point to a commit included in `main`. Only stable `vX.Y.Z` releases are supported. The tag run repeats checks before the publishing job starts.

The publishing job builds from the tag, injects the desktop app identity, creates the archive/checksum, and checks production dependency installation in an isolated directory. It uploads the archive, checksum, and `install.sh` to a **draft**, verifies the uploaded sizes and SHA-256 digests, then publishes it as latest. An interrupted upload leaves a draft; rerun the failed job to retry. An already published release is left unchanged on rerun. Publish a new version to change public assets.

### Repository secret

`TASKER_GOOGLE_DESKTOP_CLIENT_JSON` is configured in this repository's Actions secrets. It contains only the `installed.client_id` and optional `installed.client_secret` desktop application fields. The publishing step writes it into a private temporary file and removes that file afterward; normal PR checks receive no OAuth configuration. The source placeholder stays unconfigured, and the archive deliberately contains the public desktop app identity.

To rotate the identity, replace this secret with the new Desktop client configuration and publish a new version. Never use a service-account key, Web OAuth client, or user authorization tokens. No separate GitHub token is needed: the publish job uses `GITHUB_TOKEN` with `contents: write`; checks have read-only permissions.

## Preparing a local archive

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

The first release `v0.1.0` also carries the pinned `SwiftBar-headerless-universal.zip` companion artifact and its license. Preserve that asset for future installers, which use its known SHA-256 rather than an unversioned host download. See `THIRD-PARTY-NOTICES.md` for source/build provenance. Every new release attaches `install.sh`. The documented installation URL is `https://github.com/Carlos-err406/tasker/releases/latest/download/install.sh`; the source copy on `main` remains available for inspection.
