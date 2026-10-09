# Backup and recovery

Local data is `~/Library/Application Support/tasker-swiftbar/tasker.db` (or `TASKER_SWIFTBAR_DATA_DIR/tasker.db`). Images are SQLite BLOBs referenced as `/attachments/<uuid>`, not separate media files. Remote media URLs remain remote and are not copied into backups.

The service creates a due automatic backup at startup and checks each minute while running. A day means 24 hours since the last successful automatic snapshot. It does not wake the Mac. Seven automatic snapshots are kept; manual and safety snapshots remain. “Back up now” creates a manual snapshot immediately.

Each backup directory contains `snapshot.sqlite` and `manifest.json` with format/schema versions, date, kind, byte size and SHA-256. SQLite `VACUUM INTO` produces a consistent self-contained snapshot including WAL changes. It may briefly occupy the service for large databases. Do not copy only a running database's main file yourself.

Restore verifies versions, checksum, integrity, foreign keys, expected tables and managed-image references. It rejects trigger/view-bearing foreign databases. After confirmation it creates a safety snapshot, stages the selected file, checkpoints the current database and swaps under an exclusive service lifecycle. A durable recovery marker plus the intact old database lets startup roll back an interrupted activation. No image directory must be swapped. Uncommitted editor drafts are not included in snapshots.

To undo a restore, restore its **safety** snapshot. On a new Mac, configure the same Google project/client, connect Google, browse backups and restore one. Drive stores the manifest in the app-created snapshot file's metadata. The bytes use the same local validator. A local-only manual recovery can copy a completed backup directory into the new installation's `backups/` directory while the app is stopped, then restore it from the interface.

Cloud uploads use only completed local snapshots, retry with increasing delays on failure, and prune old automatic Drive files only after successful uploads. Local tasks and backups remain usable when offline. Uploaded file IDs and dates are recovery history; they never trigger automatic task merges or restores. Disconnect leaves existing cloud snapshots untouched.

Limits: 10 MiB per PNG/JPEG/WebP/GIF image; 512 MiB per cloud snapshot. No attachment garbage collection yet: undo and trashed tasks keep their images recoverable. Manual and safety snapshots can consume storage over time. Backups are unencrypted SQLite files inside a private local directory or your Google Drive.

## Import an older cli-tasker snapshot

Choose a completed, self-contained snapshot exported from cli-tasker. Do not pass its live database. Run:

```sh
pnpm import:snapshot /absolute/path/selected.sqlite /absolute/path/new-import-directory
```

The importer reads a temporary copy, preserves supported task/list/relationship fields and reports omitted tables/fields. Only the default-list setting is retained; old undo history and sync/config state are not imported. External image bytes are not silently downloaded or read from old filesystem paths. A new directory is required, so nothing existing is overwritten. Copy the generated `backups/<id>` directory into the new app's `backups/` folder, then use its ordinary restore confirmation. Alternatively start a development service using the imported directory. This is an explicit one-time import, not synchronization.
