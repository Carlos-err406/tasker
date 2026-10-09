# Current product scope

User decisions from the feature comparison on 2026-09-27. These supersede earlier parity suggestions in the MVP plan.

## MVP

- macOS SwiftBar app with local and optional Google Drive backups; preserve the task parsers and renderer.
- Add Command-K to focus search, Command-R to refresh data, and Escape to clear focused search. Preserve editor shortcuts.
- Verify drag-and-drop and native clipboard/popover behavior more thoroughly.
- Keep the current SwiftBar/LaunchAgent launch and quit arrangement.
- Keep inline metadata editing. No bulk-cleanup or separate priority/date picker UI is needed for MVP.
- On 2026-09-28 the user replaced the stacked, collapsible lists with a list picker on both Mac and Android. Show one list at a time, remember the selected list, and scope search to that list. Keep list creation, renaming, deletion, ordering and completed-task visibility available. Remove collapse controls and Command-E. This supersedes the earlier decision against a list-filter dropdown.
- The next UI iteration is desktop-only until approved: put the picker at the top left in place of Tasks, move task creation and completed-task visibility to the top-right app controls, and remove the list header/options menu. Put Create list and list management in the selector. Use View trash, View backups and View help tooltips. Keep the installed Android layout unchanged during this iteration.
- Desktop follow-up: remove Move list up/down from the selector. Give long list names more room with compact app controls and a reserved gap between the selector and toolbar; retain ellipsis and the full-name hover title.
- The user then approved carrying the finished toolbar layout to mobile. Android uses the same top-left picker and list-management actions, with Add task and completed visibility at the top right. Previews, system sort, View trash and View help share an app overflow menu to retain 44px touch targets and room for list names. Remove the mobile list header and up/down controls; backups and sync remain deferred.

## Future bucket, outside MVP

- Compact command palette, including bulk cleanup and priority/date actions.
- Apple Reminders integration.

## Not part of this version

- Migration from the original Tasker. The existing snapshot-import utility is not a release requirement; do not expand migration work or move old user data.
- Logs panel.
- AI decomposition and summaries: excluded from the new product entirely.

The original Mac MVP excludes mobile and Supabase. On 2026-09-28 the user approved a separate offline Android app first; see [android-offline.md](plans/android-offline.md). The user subsequently approved Android local and Google Drive backups on 2026-09-28; see [android-backups.md](plans/android-backups.md). The user subsequently approved Google Drive sync with the latest edit winning and Android syncing only while open; see [sync plan](plans/2026-09-28-1431-feat-google-drive-sync-plan.md).

## Mobile ergonomics follow-up — 2026-09-28

Move the list picker and app controls to a thumb-reachable bottom bar. Add and Edit open a full-screen editor with attachment, Cancel and Save actions above the keyboard. Keep task checkboxes visually compact. Swiping in either direction reveals actions; it never automatically completes or deletes a task. Use a bottom action sheet for Edit, Move, Complete/Mark pending and Trash. Mobile Help uses the desktop reference with touch instructions. Image rendering remains shared; verify it with a normal-sized attachment, since the original phone fixture was a 1x1 pixel.

## Google setup prerequisite

The app needs one developer-configured Desktop OAuth client JSON from Google Cloud. This identifies Tasker to Google; it is not a user's Google password. End users authorize their own accounts through the browser consent flow. Official builds bundle the public desktop app identity; developers can override it with local JSON. Each user grants their own account access. See [google-setup.md](google-setup.md).

## Mobile drawer parity and reserved long press — 2026-09-28

The mobile actions drawer contains the full desktop task context menu, including Copy ID/text, Create subtask, Move, every status, and task-only versus cascade deletion. Image, video, link and code actions are reachable under Content actions. Both surfaces use the same action definitions. The drawer slides in and out, respecting reduced-motion preferences. Mobile press-and-hold no longer opens a context menu or activates a row control; multiselection and batch actions remain out of scope.

- Android backups now share the desktop recovery view and snapshot format. Use native Google authorization in the existing Cloud project; never embed Desktop credentials. Keep seven automatic snapshots per device, retain manual/safety snapshots, and create a safety snapshot before every transactional restore. Scheduling runs while the app is open. Sync is a subsequent phase, not implicit in cloud backups.

## Google Drive sync (2026-09-28)

- The user approved Mac/Android sync, resolving conflicts with the most recent edit automatically. Android runs sync while Tasker is open; background scheduling remains deferred.
- Sync tasks, lists, ordering, relationships, trash and managed images through the existing Google account. Keep backups as a separate recovery feature. Restore pauses sync, and resume publishes restored changes.
- Desktop reaches Sync from Backups to preserve header space. Android also reaches Sync only from Backups, keeping its bottom App options menu compact. Back from Sync returns to Backups. No new hosting service or account system.

## Android update controls (2026-09-28)

- Add Check for updates to Android's bottom App options menu, changing to Update when a matching newer APK is found. Show version, download status and retry errors, with action buttons near the bottom.
- Use the existing public GitHub release source. Preview and production packages stay separate; downloads must match the release digest, package, newer version and installed signing key. Android retains installation confirmation and its install-from-this-app permission flow.
- Implementing the updater does not publish Android artifacts. The current release has only Mac assets, and the UI states that no Android update is published rather than treating the Mac release as an Android update.

## Shared About page (2026-09-28)

- Group version, updates and credits in About on Mac and Android. The user chose Help → About Tasker on desktop so the main header stays compact. Mobile also nests About inside Help (App options → View help → About Tasker), replacing the standalone update/About menu entry. Mobile Help omits desktop keyboard shortcuts and focuses on touch controls.
- Use one shared panel, with platform-specific update actions and external-link handlers. Keep mobile actions at the bottom. Mac checks releases and links to the existing installer/release workflow; Android retains its verified APK and system-confirmation flow. Opening About does not automatically check the network.

## Agent access through MCP (2026-10-09)

- The user chose an MCP server, not a CLI, so agents can use Tasker. Agents can read and write: list, search and read tasks with their images; add, edit, change status, move, trash and restore. On 2026-10-09 the user added list tools: create, rename and delete, with the app's rule that the default list can't be renamed or deleted. Deleting a list also deletes its tasks and can be undone in the app.
- The server runs on the Mac over stdio. It uses the running service's loopback session and `/rpc` operations, so edits keep undo, sync and the single-writer lock. Agent writes bump the change revision so an open popover refreshes. The installer writes a stable `tasker-mcp` launcher. No Android server.
- The user removed every remnant of the legacy cli-tasker app, including its local checkout, launcher and the `tasker-ref` GitHub archive.

## Recurring tasks and notifications (2026-10-09)

The user approved [the plan](plans/2026-10-09-feat-recurring-tasks-and-notifications-plan.md):
- Repeating tasks (`*weekly`, `*3d`, …) roll forward in place when completed or marked Won't Do; subtasks reset with them.
- Due dates take an optional 12-hour time (`@sat 6:30pm`), and 24-hour input is also accepted.
- Both Mac and Android notify at the due time, or at 9:00 for date-only tasks. Reminders up to 12 hours late are still delivered.
- Repeating tasks ship first as 1.1.0, then Mac notifications, then Android notifications.

## Settings page (2026-10-09)

- A **Settings** page replaces several toolbar controls on both platforms. It holds per-device switches for **Show completed tasks** (now one setting per device instead of per list), **Media previews**, **Auto sort** and **Notifications** (shown once the device can deliver them), plus the entry to **Backups & sync**. Back from Backups returns to Settings.
- **Auto sort** re-applies the system sort to every list after each change, wherever the change comes from (app, undo, MCP). An info popover explains that dragging to reorder is off while it's enabled.
- Settings live in the device-local `config` table, not browser storage, because the Mac popover's local address changes when the service restarts.
- Mac header: Add, Undo, Redo, System sort, Trash, Settings, Help. The footer keeps status messages only. Android's App options keeps Undo/Redo, System sort, View trash and View help, and gains Settings.
