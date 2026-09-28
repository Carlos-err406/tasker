# SwiftBar compatibility

SwiftBar 2.1.1, macOS 26.5.1. The plugin uses `webview=true`, a 420 × 620 native popover and an authenticated loopback service. [SwiftBar plugin API](https://github.com/swiftbar/SwiftBar#plugin-api).

## Confirmed actual-host evidence

The user opened the prototype, saved a multiline task and reopened it. The first report identified broken Markdown rendering for macOS smart-dash table/rule delimiters. After the renderer fix, the user explicitly confirmed the table, horizontal rule and quote render correctly. Their prototype tasks have been preserved in `~/Library/Application Support/tasker-swiftbar`.

The installed plugin is `~/.config/swiftbar/Tasker.1m.sh`; the per-user LaunchAgent is `org.tasker-swiftbar.service`. The temporary prototype plugin was removed after installation. The retained prototype database is `/private/tmp/tasker-swiftbar-prototype/tasker.db`.

## Remaining host checks

A final check has been requested: paste a small image into a task, save/reopen, then Backups → Back up now. The image and a dated snapshot should appear. This check is pending user feedback; browser tests cover both flows separately.

Also exercise clipboard copy, nested status/move menus near the popover edge, representative HTTPS video playback, selection/formatting/autocomplete, and close/reopen with an unfinished draft. Browser tests do not certify SwiftBar's OS clipboard and lifecycle behavior.

Automation attempt: System Events returned `osascript is not allowed assistive access (-1728)`. No Accessibility settings were changed. `pnpm test:host` prints this checklist without modifying data.

To remove the installed integration, run `pnpm uninstall:macos` from the new repository. Task data and backups are retained. Existing cli-tasker and other plugins remain independently configured.

## System theme and fork compatibility update

The Tasker icon now uses the original cli-tasker template artwork. Both menu-bar tinting and the popover palette follow system appearance; CSS applies the palette before JavaScript/authentication and reacts to changes while open.

The local fork at `/Users/carlos/Developer/SwiftBar` ([repository](https://github.com/Carlos-err406/SwiftBar)) was inspected: its `templateimage` parsing, image resizing/template preservation, webview and appearance APIs support this plugin. No fork code was changed. During the transition, the running SwiftBar process pointed at a removed `/Applications/SwiftBar.app`, and Launch Services had no `swiftbar://` handler. Tasker's installer therefore treats refresh dispatch as best-effort; a successful service installation remains successful without the URL handler. The plugin refresh interval is one minute.

A stale runtime file with an unloaded LaunchAgent reproduced “Tasker unavailable.” The plugin now bootstraps its already-installed LaunchAgent or starts a registered stopped instance, with bounded retries and a health check. The SQLite service lock still prevents duplicate writers. Failure details stay in the dropdown while the menu bar keeps its icon. The installed service recovered through this exact plugin path and returned HTTP 204. Why the previous LaunchAgent registration disappeared is not established.

Verification: 270 unit tests and 10 WebKit E2E tests pass. New coverage checks the original icon hash, recovery through an isolated temporary LaunchAgent without duplicate service PIDs, dark styling with JavaScript disabled, and live dark/light changes. The E2E helper now waits for saving to finish before beginning the next action. Actual visual confirmation in the user's newly launched fork is still separate from these automated checks.
