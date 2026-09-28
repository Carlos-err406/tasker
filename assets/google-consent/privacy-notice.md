# Tasker Privacy Notice

Draft for the current macOS app, prepared September 27, 2026. Review and publish this notice before using its public URL in Google Console.

## Your data on your Mac

Tasker stores tasks, lists, descriptions, tags, dates, relationships, editing history, and pasted images in a local SQLite database on your Mac. Some interface preferences are stored separately on your Mac. Tasker creates local recovery snapshots of the database. No Tasker-hosted account or cloud service is required to use the app.

## Optional Google Drive backups

If you connect a Google account, Tasker sends completed database snapshots directly from your Mac to your Google Drive. Snapshots include database contents such as tasks, trashed tasks, history, and pasted images; they are not limited to the tasks currently visible in the app. Existing local snapshots can also be uploaded after you connect. Unsaved editor drafts and media available only through remote URLs are not included as downloaded content.

Tasker creates a folder called “Tasker backups” and manages its own snapshot files there. It accesses their contents and metadata to upload, list, validate, download, restore, and retain backups. Google receives this information as the storage provider. These backups are for recovery; they do not continuously synchronize or merge tasks between devices.

Tasker requests Google's `drive.file` permission, which limits authorization to app-created files and files explicitly made available to the app. Tasker's backup implementation operates on its own backup files. It does not request broad access to your Drive, email, contacts, calendar, or Google Tasks.

## Authorization and security

You authorize Tasker through Google's sign-in and consent screens in your browser. Tasker does not receive or store your Google password. It stores the refresh token used for ongoing access in macOS Keychain and holds access tokens in service memory. Those tokens are not included in database snapshots. Transfers to Google's APIs use HTTPS.

Local databases and backup files are not encrypted by Tasker. Google Drive backups are not end-to-end encrypted by Tasker. Anyone with access to a backup file may be able to read its contents. Your Mac and Google account protections remain important.

## Use and sharing

Tasker uses Google user data solely to provide the backup and restore features described here. The app does not send your database to a Tasker-operated server and has no built-in advertising, analytics, or AI processing. The developer does not receive your tasks or Google tokens through this backup flow. Tasker does not sell Google user data or use it for advertising or model training.

When you display externally linked images, media previews, or open links, your device may contact those third-party services. They may receive network information such as your IP address and the requested URL under their own privacy practices. Remote media is separate from Google Drive backup access.

## Retention, disconnection, and deletion

Tasker retains the seven most recent automatic snapshots locally and applies the same limit to completed automatic Drive backups. Manual and restore-safety snapshots remain until removed. Deleting a task does not remove its content from existing snapshots, and recoverable task history or pasted images may remain in the database.

Disconnecting Google in Tasker removes the locally stored authorization grant and stops subsequent cloud uploads. It does not delete existing Drive files or local tasks. You can revoke Tasker's access in your Google Account's third-party connections settings. Delete unwanted cloud snapshots from Google Drive; Google's own deletion and retention rules then apply. Disconnect Tasker first if you do not want retained local snapshots uploaded again.

To remove all local data, stop Tasker and remove its data directory, normally `~/Library/Application Support/tasker-swiftbar`, along with any separately copied backups. Disconnect Google before uninstalling if you also want the local Keychain grant removed. Restoring a snapshot can bring back data deleted after that snapshot was created.

## Contact and changes

For questions about this app or its handling of Google data, contact the support email displayed in Tasker's Google consent screen. The public version of this notice should also list that monitored support address directly. This notice should be updated when the app's data practices change.
