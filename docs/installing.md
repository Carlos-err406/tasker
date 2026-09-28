# Installing and updating Tasker

Tasker's installer supports Intel and Apple Silicon Macs running macOS 13.5 or later. This minimum follows the pinned Node runtime's [supported platforms](https://github.com/nodejs/node/blob/v26.8.1/BUILDING.md#platform-list).

```sh
curl -fsSL https://github.com/Carlos-err406/tasker/releases/latest/download/install.sh | bash
```

To inspect the installer first, download that URL to a file and run it with `/bin/bash`. The script checks release and runtime downloads before extraction and does not need sudo or a Homebrew installation.

## What gets installed

- Tasker versions under `~/.local/share/tasker/versions`, with `current` pointing to the active version.
- Private, pinned Node.js 26.8.1 and pnpm 10.14.0 runtimes under `~/.local/share/tasker/runtimes`. Your global Node/pnpm installation and shell startup files are untouched.
- A per-user LaunchAgent at `~/Library/LaunchAgents/org.tasker-swiftbar.service.plist` and a managed `Tasker.1m.sh` plugin in SwiftBar's configured plugin directory (or `~/.config/swiftbar` for first setup).
- If SwiftBar is missing, the tested universal fork in `~/Applications/SwiftBar.app`, with its license notice alongside it. Existing applications are preserved. The companion build has the popover and native clipboard fixes Tasker needs. It is ad-hoc signed, not notarized; if macOS blocks opening it, use its normal Privacy & Security → Open Anyway flow. The installer does not disable Gatekeeper or remove quarantine attributes.

Task data remains in `~/Library/Application Support/tasker-swiftbar`, including existing installations from source. Google grants stay in Keychain. The installer does not upload tasks, restore snapshots, or change Google's audience settings. The running app continues its configured automatic backup behavior.

## Updates and recovery

Run the same command again. Downloads and dependency installation finish before changing the active service. The installer checks that the new service process is healthy before switching the `current` pointer. If activation fails, it restores the previous LaunchAgent and plugin files and attempts to restart the old service. Earlier app versions remain on disk; no task database is replaced during this process.

Only one installation runs per install root at a time. If a forcibly terminated installer leaves `.install-lock`, confirm no installer is running before removing that empty directory and retrying.

Pin a release:

```sh
curl -fsSL https://github.com/Carlos-err406/tasker/releases/latest/download/install.sh | bash -s -- --version=v0.1.0
```

A version pin selects app code. It does not roll back database changes. This initial release uses one schema version; future migrations must define their own rollback compatibility.

## Custom paths and local checks

`TASKER_INSTALL_ROOT` changes the managed runtime directory. `TASKER_SWIFTBAR_PLUGIN_DIR` selects a plugin directory. `TASKER_SWIFTBAR_APP` selects an existing compatible SwiftBar app. Existing `TASKER_SWIFTBAR_DATA_DIR` and `TASKER_SWIFTBAR_LAUNCHAGENT_DIR` overrides are supported too. Use absolute paths. Pass variables to the shell receiving the script, not just to curl.

For maintainer checks, `--archive=/absolute/path/to/release.tar.gz` uses a local archive with its adjacent `.sha256` file. `--prepare-only` verifies/downloads runtimes and installs dependencies without modifying LaunchAgents, plugins, app data, SwiftBar, or the active-version pointer. It still writes the chosen install root and the package-manager cache.

## Remove the integration

```sh
bash "$HOME/.local/share/tasker/uninstall.sh"
```

This removes the managed plugin and login service. It retains Tasker app files, the SwiftBar host, task data, backups, and Google authorization. Disconnect Google in the app first if you also want to remove its local Keychain grant. After uninstalling, the managed `~/.local/share/tasker` directory can be removed separately; it does not contain the task database. Do not remove the data directory unless you intend to delete your local tasks and backups.
