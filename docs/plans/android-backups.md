# Android backups

Approved 2026-09-28: add the backups view and complete local/Google Drive backup and restore, before beginning synchronization.

- Reuse the Mac snapshot format (SQLite plus versioned manifest, SHA-256, embedded attachments) and shared backup view with injected host operations.
- Native Android owns snapshot files, validation and transactional restore. Validate schema, integrity, foreign keys, attachment references and checksum before creating a safety snapshot and replacing table contents atomically. Credentials stay outside snapshots.
- Create due local snapshots while the app is active; retain seven automatic snapshots, preserve manual/safety snapshots. Run file and network operations off the UI thread.
- Use Google AuthorizationClient with drive.file and the existing Tasker Drive format. Register the Android package/signing fingerprint in the same Google project; user consent happens on the phone. Do not reuse desktop account grants or upload test data to the user's account.
- Add View backups to mobile app options, with busy/error feedback, explicit restore confirmation, and refresh after restore. Keep desktop behavior intact.
- Verify native snapshots/restore/failure paths in isolated databases, shared UI behavior, build/typecheck/unit/WebKit checks, and real phone backup UI. Never test destructive restore against the user's phone data. Sync design and implementation follow this phase.
