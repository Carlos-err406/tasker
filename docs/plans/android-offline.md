# Offline Android app

## Goal

Build and install an offline Android Tasker on the connected physical device. The user approved offline Android first on 2026-09-28. Reuse the current parser, queries, editor and Markdown rendering. No emulator or new IDE is needed.

## Scope

Tasks, lists, metadata/search, stable order, status, trash, undo/redo, local images, and durable private SQLite storage. Touch controls must support saving multiline edits without a hardware keyboard. The app starts with its own empty database. Mac data, Google credentials and cli-tasker data are never used.

Google backup/restore, device sync, notifications, store publication and a mobile release pipeline are follow-up work.

## Implementation

1. Extract the portable operation registry from the Mac service into core, preserving transport contracts and validation. Keep Node-only entry points separate.
2. Add apps/android: a Vite web entry using shared UI, a synchronous SQLite adapter for existing Drizzle queries, and a small platform WebView host. Serve bundled assets on a fixed HTTPS origin, restrict navigation and scripts, disable frames/file access, and open external links in the browser. Images remain SQLite BLOBs with portable attachment references.
3. Add phone-sized controls, touch editing and image selection while retaining Mac behavior. Build a debug APK using the installed Java 17, SDK and cached Gradle. Install via adb.
4. Verify shared operations, persistence, transactions, attachment handling and phone flows. Record evidence in docs/implementation-status.md.

## Verification and done

Run pnpm build, pnpm test, pnpm typecheck and pnpm test:e2e with isolated data. Add Android adapter integration coverage, native compilation/lint and physical-device checks for create/edit, metadata search, status, undo, images and force-stop/relaunch persistence. Inspect the phone UI and soft keyboard. Preserve an installable APK and document build/install commands and limitations. No publishing or Mac host changes are part of this request.

## Technical references

- https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- https://developer.android.com/build/releases/agp-8-12-0-release-notes
