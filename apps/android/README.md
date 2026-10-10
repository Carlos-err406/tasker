# Tasker for Android

An offline app using the shared React editor, task parsers, queries and undo history. The Android shell serves bundled web assets and stores tasks and image BLOBs in private native SQLite. It requires Android 11 or later and a current Android System WebView.

No Mac connection, Google login, emulator, Android Studio or paid hosting is required. Google Drive backups and Mac sync are optional. A fresh install starts with an empty database. The debug package is `org.tasker.android.debug`, labelled **Tasker Preview**, separate from the production **Tasker** package `org.tasker.android`. Uninstalling either app removes its local data; `adb install -r` preserves data.

## Build and install

Use the repository's Node/pnpm versions, Java 17, Android SDK platform 35, and build tools 35.0.0. The checked-in Gradle wrapper uses 8.14.3 and Android Gradle Plugin 8.12.0. Existing Gradle/SDK caches are reused; no emulator or NDK is required. A machine without those caches must download the build dependencies.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:android
adb devices -l
ANDROID_SERIAL=<your-device-serial> pnpm install:android
```

The helper uses `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the standard macOS/Linux SDK location. Set `JAVA_HOME` if Java 17 is not your default. Enable USB debugging and authorize the Mac on your phone. Installation never clears existing app data.

The APK is `apps/android/native/app/build/outputs/apk/debug/app-debug.apk`. This is a development build with WebView debugging enabled. Production APKs use the separate package `org.tasker.android`, a permanent signing key and disabled debugging. Keep signing keys, APKs, local.properties and Gradle outputs out of Git.

## Verification

```sh
pnpm build
pnpm test
pnpm typecheck
pnpm test:e2e
node apps/android/scripts/gradle.mjs assembleDebug lintDebug
```

Adapter tests exercise real SQLite behind the native JSON protocol, including transaction rollback and persisted undo. Mac WebKit tests cover shared rendering and editor behavior. Physical-device checks remain necessary for the native bridge, attachments, keyboard, Back, process recreation and layout. Use isolated fixture databases for automated checks. Real sync checks use temporary QA tasks after safety backups; never connect to cli-tasker's database.

## Boundaries

Only bundled scripts run in the privileged WebView, under a fixed HTTPS origin and restrictive Content Security Policy. Navigation opens HTTP(S) links externally; frames, file URLs, cleartext resources and remote scripts are blocked. SQLite image BLOBs are served only by their portable attachment references. OS-managed automatic backup/device transfer remains disabled; recovery uses the explicit Tasker backup flow.

Shared operations live in `packages/core/src/operations`; Mac transport re-exports the same registry. The Android adapter imports portable core entry points and Drizzle's synchronous session, never a Node SQLite driver. The Java host implements that session's parameterized query, transaction and image protocol.

Touch editing opens a full-screen editor with image attachment, Cancel and Save above the keyboard. Swipe a task in either direction or tap its three dots to reveal an animated bottom action sheet with the full task menu: Edit, Copy ID/text, Create subtask, Move, all four statuses, and Delete (including task-only or cascade deletion for parents). Content actions includes image, video, link and code commands; swipes never change data directly. Vertical scrolling remains separate from horizontal swipes. Long-press does not open menus or activate row controls; it is reserved for future multiselection and batch actions. Custom touch drag reordering is not included, while stored order is preserved.

The top bar's title is the list picker: it shows one list at a time and remembers the selection. Create, rename and delete lists in the picker. Under the title, a status line shows the pending count and, while sync is on, the sync state. The magnifier opens search, which stays within that list; closing it or pressing Back clears it. The round plus at the bottom right opens the task editor. App options (⋯) contains undo/redo, system sort, View trash, Settings and View help. About Tasker is inside Help. Trash, Settings, Backups, Help and About hide the top bar and the plus; use the back arrow or Android Back to return. Long names truncate to leave room for 44px toolbar touch targets. Checkboxes are visually compact, with expanded hit areas. Help explains touch controls and the shared metadata, date and search syntax; keyboard shortcuts appear only on desktop. Managed images render inline and open in an image viewer when tapped. Save or cancel a draft before switching lists or opening another panel.

## Backups and Google Drive

Open **App options → View backups** for the same recovery controls as desktop. Back up now keeps a manual snapshot. While the app is open, it creates an automatic snapshot when the last one is at least 24 hours old, retaining seven automatic snapshots. Manual and pre-restore safety snapshots are retained. Each snapshot includes task data, images, settings, and undo history; account grants stay outside the database. Snapshots have a 512 MB limit.

Connect Google uses Android's Google Play services account chooser and the `drive.file` scope. Register an Android OAuth client in the same Cloud project as desktop, using the package and SHA-1 certificate from `node apps/android/scripts/gradle.mjs signingReport`. The development package is `org.tasker.android.debug`; a release package and signing key need a separate registration. No desktop secret or downloaded client JSON belongs in Android source. When Google's project is in testing, the chosen account must be a configured test user.

Connected backups upload automatically, with retry after network errors. Back up now creates a snapshot and uploads it. **Restore…** lists this phone's snapshots together with compatible Mac and Android snapshots in Drive. Restore validates the checksum, schema, relationships and image references, creates a safety snapshot, then replaces the tables in a single transaction. The UI refreshes its task data and undo history before re-enabling controls. Disconnect stops future cloud work without revoking the Mac connection. Snapshots remain separate from the live sync feature. Android schedules backups only while the app is open; no persistent background service runs.

Native recovery and fake-network tests use temporary databases and never access account grants:

```sh
pnpm build
node apps/android/scripts/gradle.mjs assembleDebug assembleDebugAndroidTest lintDebug
adb install -r apps/android/native/app/build/outputs/apk/debug/app-debug.apk
adb install -r apps/android/native/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e class org.tasker.android.BackupStoreTest,org.tasker.android.DriveBackupsTest,org.tasker.android.SyncDatabaseTest org.tasker.android.debug.test/android.test.InstrumentationTestRunner
```

## Mac sync

Choose **App options → Backups & sync** and turn on the **Sync** switch on both devices using the same Google account. First enable creates a safety backup and merges both datasets. Tasks, lists, ordering, relationships, trash and managed images sync; the latest recorded edit wins. The phone syncs only while Tasker is open, after edits and every 30 seconds. Pending offline changes survive app restarts. Open editors defer incoming updates.

Pause keeps local data. Restore pauses sync automatically and creates a fresh device publication identity; resume sends the restored changes as new edits. Account changes pause transfers until the original account is reconnected. Device identity and account binding are stored outside portable snapshots; Google tokens stay in native code.

## App updates

Choose **App options → View help → About Tasker → Check for updates**. The app checks the latest stable release in `Carlos-err406/tasker`. When a newer matching Android package exists, the About page offers **Update to …**. Download progress and failures are shown in the view, with its buttons at the bottom. Android handles installation confirmation; the first install may require allowing updates from Tasker in system settings. Return and tap **Install update** after granting that permission. Cancelling installation keeps the installed app and its data.

Release asset contract:

- Debug preview: `tasker-android-preview.apk` (`org.tasker.android.debug`). Production: `tasker-android.apk` (`org.tasker.android`). The updater never crosses between them.
- The stable tag is `vX.Y.Z`; the APK version name is `X.Y.Z`, and its version code is `major * 1000000 + minor * 1000 + patch`. Minor/patch must be at most 999. This replaces the original fixed version code of 1.
- Upload a fully signed APK as a GitHub release asset. The updater requires GitHub's `sha256:` asset digest and verifies downloaded size, checksum, package, version and the installed signing certificate before opening the installer. Keep the same signing key for subsequent builds. A replacement signing identity requires a separately designed migration; never uninstall the user's app to work around it.
- APKs are bounded to 100 MiB. Downloads are private temporary cache files; only the validated APK receives a temporary read grant to Android's installer. No account credentials are used or sent to GitHub.

Starting with v0.2.0, stable releases include the verified production APK through the workflow below. Earlier releases contain Mac assets only. Preparing an APK does not publish it; publication still requires a new aligned version and a tag on merged main. Preview builds remain separate development artifacts and are not published by this workflow.

Reference contracts: [GitHub release assets](https://docs.github.com/en/rest/releases/assets), [Android FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider), and [Android package validation and install permission](https://developer.android.com/reference/android/content/pm/PackageManager).

The shared About page shows the installed version, update controls and credits with links to the project and its open-source foundations. Merely opening About does not contact GitHub; Check for updates is explicit.

## Production signing and packaging

`pnpm release:android` builds the web UI, signs the production APK, runs release lint, verifies its package/version/certificate with Android SDK tools, and writes `release/tasker-android.apk` plus its `.sha256` file. It does not install or publish anything. Java 17 and Android build tools 35.0.0 are required.

Supply `TASKER_ANDROID_KEYSTORE`, `TASKER_ANDROID_STORE_PASSWORD`, `TASKER_ANDROID_KEY_ALIAS` and `TASKER_ANDROID_KEY_PASSWORD` as private environment variables. For local builds, `TASKER_ANDROID_SIGNING_FILE` may instead point to a private JSON file outside the checkout containing `keystore` (absolute path), `storePassword`, `keyAlias` and `keyPassword`. Missing signing configuration fails packaging; unsigned and debug APKs cannot become the production artifact.

The public SHA-256 certificate fingerprint is pinned in `release-certificate.sha256`. Keep the original signing key and its passwords in secure backups: subsequent APK updates must use the same identity. Never regenerate it to bypass a failed build or installation.

The tag-only publishing job uses the encrypted repository secret `TASKER_ANDROID_SIGNING_JSON`, containing `keystoreBase64`, `storePassword`, `keyAlias` and `keyPassword`. Its helper creates a private temporary keystore, signs/verifies the APK and removes temporary signing files on exit. PR checks build/lint the debug app without access to signing secrets. The publisher requires and verifies both the Mac and Android assets before making a release public.

The production Google client uses package `org.tasker.android` and the production certificate. Registration does not change the Google project's test-user audience; broader availability is a separate release gate.

### Moving from Preview to Tasker

Install the signed Tasker app alongside Tasker Preview. Keep Preview installed while confirming its latest changes have synced. In Tasker, connect the same Google account under Backups and enable Sync to retrieve tasks, lists and images. Confirm the content before retiring Preview. Do not copy account grants or uninstall Preview to work around package/signature checks. The two packages cannot update one another.

References: [Android signing](https://developer.android.com/studio/publish/app-signing) and [APK signature verification](https://developer.android.com/tools/apksigner).
