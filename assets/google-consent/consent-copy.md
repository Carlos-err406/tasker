# Tasker — consent-screen copy

## App name

Tasker

## Short description

A macOS menu-bar task manager with local storage and optional Google Drive backups.

## App description

Tasker keeps your tasks, lists, notes, and pasted images on your Mac. Organize tasks with Markdown, tags, priorities, and due dates. Connect your Google account to save recovery backups in your own Google Drive and restore them when needed. Google Drive backups are optional; Tasker works offline without a Google account.

## Why Tasker requests Google Drive access

Tasker uses Google Drive only to back up and restore your Tasker database. It creates a “Tasker backups” folder, uploads completed snapshots, lists and downloads its snapshots when you browse or restore them, and deletes older automatic backups according to its retention policy. Snapshots include tasks, lists, pasted images, and other data stored in the local database. Tasker does not request access to all files in your Drive or use Drive to synchronize or merge live tasks across devices.

## Scope justification

Tasker requests `https://www.googleapis.com/auth/drive.file` to create, read, update, and delete its own backup files and folder. These operations support uploading recovery snapshots, listing available backups, downloading a selected snapshot for restoration, retrying uploads, and retaining the seven most recent automatic backups. Broad Drive access is unnecessary. The app does not request Gmail, Calendar, Contacts, Google Tasks, or Google profile scopes.

## Matching Console settings

| Field | Value |
| --- | --- |
| App name | Tasker |
| App logo | `tasker-logo-120.png` |
| OAuth client display name | Tasker macOS |
| Application type | Desktop app |
| Audience for personal Gmail testing | External |
| Publishing status for initial testing | Testing |
| API to enable | Google Drive API |
| Requested scope | `https://www.googleapis.com/auth/drive.file` |
| Support email | Your monitored Google account, selected in Console |
| Developer contact | Your monitored email address |
| Test users | Your Google account and any explicitly invited testers |

The OAuth client display name is an administrative label, separate from the app name users see. A Desktop app uses a temporary loopback callback; do not create a Web application client or invent public redirect URLs.
