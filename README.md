# Tasker

Repository: [Carlos-err406/tasker](https://github.com/Carlos-err406/tasker).

A local task manager for macOS in SwiftBar and Android, preserving cli-tasker's parser and React Markdown renderer. Each device stores tasks and pasted images in SQLite. Local snapshots work offline; optional Google Drive backups and sync connect your devices.

## Install

On macOS 13.5 or later, run:

```sh
curl -fsSL https://github.com/Carlos-err406/tasker/releases/latest/download/install.sh | bash
```

No Homebrew, Node setup, pnpm setup, or sudo is required. The installer downloads a verified release and private runtimes under `~/.local/share/tasker`, installs the service and plugin, and opens SwiftBar. If SwiftBar is missing, it installs the tested [Carlos-err406/SwiftBar fork](https://github.com/Carlos-err406/SwiftBar) in `~/Applications`. Existing SwiftBar installations are preserved; Tasker requires the fork’s native clipboard support. The fork is ad-hoc signed, so macOS may ask you to allow it in **System Settings → Privacy & Security → Open Anyway**.

Click Tasker’s menu-bar icon. To enable cloud backups, open **Backups → Connect Google**. Rerun the same installer to update; tasks, backups, and Google authorization stay in place. See [installer details](docs/installing.md) for version pinning, custom directories, and removal.

## Run from source

Validated on macOS with SwiftBar 2.1.1, Node 26.8.1 and pnpm 10.14.0. Install the [supported SwiftBar fork](https://github.com/Carlos-err406/SwiftBar) and Node/pnpm first; no paid developer account or hosted service is required.

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

Click Tasker in the menu bar. Choose a list at the top left; search applies to that list, and Tasker remembers your selection. The selector also contains list creation, rename and delete. Use the top-right plus button to add a task; save with Command-Enter. Undo and redo sit beside it. The gear opens **Settings**, which holds this device's options (show completed tasks, media previews, auto sort and, as they arrive, notifications) and **Backups & sync**. Right-click a task to edit, change status, move, or trash it. Metadata belongs on trailing metadata-only lines (`p1 #tag @tomorrow`). A due date can take a time (`@sat 6:30pm`), and `*weekly`, `*monthly`, `*3d` and similar make a task repeat: completing it moves it to its next date instead. The existing relationship syntax and Markdown shortcuts are retained. Paste images into new tasks or the task editor. Search, lists and trash recovery are available in the popover.

## Use from AI agents

Tasker includes an MCP server so agents such as Claude Code can read and manage your tasks, including the images attached to them. The installer writes its launcher to `~/.local/share/tasker/tasker-mcp`. Register it once:

```sh
claude mcp add --scope user tasker -- ~/.local/share/tasker/tasker-mcp
```

Other MCP clients run the same command over stdio. From a source checkout, use `node apps/macos/dist-service/mcp/main.js` after `pnpm build`.

Agents can list, search and read tasks, and add, edit, complete, move, trash and restore them. They can also create, rename and delete lists; as in the app, the default list can't be renamed or deleted. The server talks to the running Tasker service on this Mac, so Tasker must be running. Agent edits use the normal task operations: they can be undone in the popover, appear in an open popover, and sync to your other devices. There is no Android MCP server.

See [Google setup](docs/google-setup.md), [backup and recovery behavior](docs/backups.md), [architecture](docs/architecture.md), [source provenance](docs/source-provenance.md), and [validation status](docs/implementation-status.md).

## Check

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @tasker/macos exec playwright install webkit
pnpm test:e2e
```

Tests use temporary databases and fake Google endpoints. For an explicit real-host checklist, run `pnpm test:host`; it does not control macOS or create test data automatically.

## Remove the integration

```sh
pnpm uninstall:macos
```

This stops/removes the LaunchAgent and its managed SwiftBar plugin. It retains tasks, backups, and Keychain credentials; disconnect Google in the app first if you also want its grant removed. Data defaults to `~/Library/Application Support/tasker-swiftbar`.

The original Mac MVP has expanded to Android and Google Drive sync. No hosting service, Supabase, or CalDAV is required.

## Android

Download [tasker-android.apk](https://github.com/Carlos-err406/tasker/releases/latest/download/tasker-android.apk) on a phone running Android 11 or later and open it to install. Android may ask you to allow installation from your browser. The app works offline, with local/Google Drive backups and optional Mac sync. Check for subsequent updates in **App options → View help → About Tasker**.

Tasker installs separately from Tasker Preview. Keep Preview until its changes have synced, then connect the same Google account and enable sync in Tasker. See [Android build, signing and migration details](apps/android/README.md).

## Sync between Mac and Android

Open **Backups & Sync** on both devices, connect the same Google account, then turn on the **Sync** switch on each device. Enabling creates a safety backup and combines both devices' tasks, lists, relationships, order, trash and managed images. The most recent recorded edit wins conflicts. Local UI preferences and undo history stay on their own device.

Google Drive features currently require an account enrolled as a test user in Tasker's Google project. Offline use does not require a Google account.

Sync runs after edits and every 30 seconds while the Mac service runs or Android is open. Offline edits persist and retry. Turning the switch off pauses transfers without deleting local tasks. Restoring a backup pauses sync; turning it back on publishes the restored changes. When Google's login expires, **Reconnect** appears in the panel and resumes sync once you approve. An open editor defers incoming changes until Save or Cancel.

Sync files are separate from recovery snapshots. Old tasks without recorded edit times have a deterministic first-merge tie-break; their historical edit order cannot be reconstructed. Device clocks affect concurrent offline conflicts. Image objects are retained in Drive; automatic removal of unused images is deferred.

## About Tasker

Open **Help → About Tasker** on Mac or **App options → View help → About Tasker** on Android for the installed version, credits and update controls. Check for updates queries the latest stable GitHub release. Mac offers a link to the available release and continues to use the installer described above; Android downloads a matching signed APK and opens its system installer. Opening About by itself does not perform a network check.
