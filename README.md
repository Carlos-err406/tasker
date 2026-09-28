# Tasker

Repository: [Carlos-err406/tasker](https://github.com/Carlos-err406/tasker). The original app is retained separately as [tasker-ref](https://github.com/Carlos-err406/tasker-ref).

A local macOS task manager in SwiftBar, preserving cli-tasker's parser and React Markdown renderer. Tasks and pasted images live in one SQLite database. Local snapshots work offline; optional Google Drive uploads add recovery backups.

## Run

Validated on macOS with SwiftBar 2.1.1, Node 26.8.1 and pnpm 10.14.0. Install [SwiftBar](https://github.com/swiftbar/SwiftBar) and Node/pnpm first; no paid developer account or hosted service is required.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm install:macos
```

The per-user LaunchAgent starts the service at login and restarts it if it stops. The plugin also recovers an unloaded agent on refresh. Tasker uses the original tray icon and follows the system light/dark theme. The plugin defaults to `~/.config/swiftbar/Tasker.1m.sh`; choose that folder in SwiftBar, or set `TASKER_SWIFTBAR_PLUGIN_DIR` to your existing plugin folder during installation. The same plugin API is supported by [Carlos’s SwiftBar fork](https://github.com/Carlos-err406/SwiftBar); if its URL handler is not registered yet, open your build and let its normal plugin refresh run. The installer records the Node executable and repository paths, so rerun it after moving the checkout or upgrading/removing that Node installation.

For a temporary development session:

```sh
TASKER_SWIFTBAR_DATA_DIR=/private/tmp/tasker-swiftbar-dev pnpm start
```

Keep the repository and installed dependencies in place. After updating source, build successfully before rerunning the installer. This is a source installation, not a signed standalone binary.

## Release archive

`TASKER_GOOGLE_BUILD_CLIENT_JSON=/absolute/path/to/desktop-client.json pnpm release:archive` creates a configured runtime archive under `release/`. Recipients extract it, run `pnpm install --frozen-lockfile`, then `pnpm install:macos`. Node, pnpm, and the supported SwiftBar host are still required; this is not a standalone app bundle. See [release instructions](docs/releasing.md).

Official release archives include the public Google Desktop OAuth configuration. Users only need **Backups → Connect Google**. Source checkouts contain no shared client values: source builds use a local JSON override or the build-time configuration described in [Google setup](docs/google-setup.md).

## Use

Click Tasker in the menu bar. Use the plus button to add a task; save with Command-Enter. Right-click a task to edit, change status, move, or trash it. Metadata belongs on trailing metadata-only lines (`p1 #tag @tomorrow`). The existing relationship syntax and Markdown shortcuts are retained. Paste images into new tasks or the task editor. Undo/redo, search, lists, trash recovery, media controls and backups are available in the popover.

See [Google setup](docs/google-setup.md), [backup and recovery behavior](docs/backups.md), [architecture](docs/architecture.md), [source provenance](docs/source-provenance.md), and [validation status](docs/implementation-status.md).

## Check

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @tasker/macos exec playwright install webkit
pnpm test:e2e
```

Tests use temporary databases and fake Google endpoints. They never use the original cli-tasker database. For an explicit real-host checklist, run `pnpm test:host`; it does not control macOS or create test data automatically.

## Remove the integration

```sh
pnpm uninstall:macos
```

This stops/removes the LaunchAgent and its managed SwiftBar plugin. It retains tasks, backups, and Keychain credentials; disconnect Google in the app first if you also want its grant removed. Data defaults to `~/Library/Application Support/tasker-swiftbar`, distinct from cli-tasker.

MVP scope: Mac app and recovery backups. No Supabase, mobile application, CalDAV, or cross-device merge. The SQLite image references and shared TypeScript packages avoid Mac-specific paths in task content for possible future Android use.
