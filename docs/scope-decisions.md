# Current product scope

User decisions from the feature comparison on 2026-09-27. These supersede earlier parity suggestions in the MVP plan.

## MVP

- macOS SwiftBar app with local and optional Google Drive backups; preserve the task parsers and renderer.
- Add Command-K to focus search, Command-R to refresh data, and Escape to clear focused search. Preserve editor shortcuts.
- Verify drag-and-drop and native clipboard/popover behavior more thoroughly.
- Keep the current SwiftBar/LaunchAgent launch and quit arrangement.
- Keep inline metadata editing. No bulk-cleanup or separate priority/date picker UI is needed for MVP.
- No dedicated list-filter dropdown. The explicit search-shortcut request still applies.

## Future bucket, outside MVP

- Compact command palette, including bulk cleanup and priority/date actions.
- CLI integration with the new app's database/service.
- Apple Reminders integration.
- Due-date notifications.

## Not part of this version

- Migration from the original Tasker. The existing snapshot-import utility is not a release requirement; do not expand migration work or move old user data.
- Logs panel.
- AI decomposition and summaries: excluded from the new product entirely.

Mobile and Supabase remain outside the approved MVP. Any later mobile client would target Android.

## Google setup prerequisite

The app needs one developer-configured Desktop OAuth client JSON from Google Cloud. This identifies Tasker to Google; it is not a user's Google password. End users authorize their own accounts through the browser consent flow. Official builds bundle the public desktop app identity; developers can override it with local JSON. Each user grants their own account access. See [google-setup.md](google-setup.md).
