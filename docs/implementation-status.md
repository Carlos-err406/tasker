# Implementation status — 2026-09-27

Initially implemented in `/Users/carlos/self-development/tasker-swiftbar`, branch `codex/swiftbar-mvp`. The canonical checkout is now `/Users/carlos/Developer/tasker`, with origin `https://github.com/Carlos-err406/tasker.git`. Original source tracked changes were preserved; no original task database or startup configuration was used.

| Unit | Result | Evidence |
| --- | --- | --- |
| U1: writable popover | Implemented; basic real-host check confirmed | SwiftBar 2.1.1 on macOS 26.5.1. User confirmed the saved task renders its table, rule and quote after reopening. Private session/Host/Origin tests pass. |
| U2: shared parser/storage | Implemented | 220 core tests, including original parser/query/undo cases plus BLOB storage. Explicit standalone-snapshot importer preserves the source bytes and reports omitted fields. |
| U3: renderer | Implemented; 36 WebKit scenarios | User confirmed native clipboard/image paste and Markdown rendering. Combined task/media menus have WebKit coverage; direct native video playback remains a manual check. |
| U4: local recovery | Implemented | Task/image restore, safety recovery, checksum/schema rejection, retention, and restore-boundary process exits pass. |
| U5: Google backups | Implemented; live round trip confirmed | User confirmed account connection, two Drive backups, and successful restore. Other-account availability, live token refresh and revocation remain unverified. |
| U6: installation/docs | Public curl installer; automated release workflow added | Isolated installation, repeated update with retained task data, and uninstall passed. Clean-machine and sleep/wake testing remain unperformed. |

## Initial validation (historical)

- `pnpm build`: passed. Vite reports the inherited renderer's large-chunk warning (828 KB uncompressed / 254 KB gzip).
- `pnpm typecheck`: passed across all packages.
- `pnpm test`: 268 passed (220 core, 25 UI helpers, 23 service/backup/Google/import).
- `pnpm test:e2e`: 8 WebKit tests passed, against the real local service with temporary databases. Includes exact checkbox-line persistence, bold editing, sanitized raw HTML, smart-dash tables/rules, failed-draft retry, pasted image + backup/safety restore, status/search/trash, and nested list move menus.
- Installer smoke: temporary data/plugin/LaunchAgent paths, plist validation and removal; then actual per-user installation and service health verification. A launchd unload/reload timing race was fixed with bounded retries; two consecutive reinstalls passed. No full clean-Mac matrix claimed.
- No separate lint command is configured. New implementation files were formatted with pinned Prettier; TypeScript checks provide static validation.
- Playwright's initial download extractor stalled; the completed archive was extracted with macOS unzip. Final E2E passes use the pinned 1.58.2 WebKit build 2248. Earlier tests with the existing WebKit 2336 override are not the final evidence.
- A build command was accidentally run once in the original checkout; it changed only generated build outputs. Its pre-existing source changes remained unchanged.

## Review

See `docs/reviews/mvp-review.md` for the manual review, applied fixes, simplification and review-tool limitation. Code review: skipped (ce-code-review unavailable) — its scope stage requires a Git base; this repository was unborn at that stage. No independent completed review receipt is claimed.

## Scope and limitations

MVP remains macOS plus backups. No Supabase, mobile, CalDAV, backend hosting, Google Tasks, or task merge engine. Android portability is retained through shared TypeScript logic and database attachment IDs.

Google setup: `docs/google-setup.md`. The user confirmed the live cloud backup/restore round trip and native clipboard/image paste. Fresh-account authorization, direct native video playback, and clean-machine/sleep testing remain separate checks.

The user-approved plan is unchanged. Source provenance is recorded. Public redistribution terms must be settled before publishing copied source.

## Popover layout repair — 2026-09-27

- Replaced the duplicate app heading and text navigation rows with a compact Lucide toolbar and labeled tooltips, retaining SwiftBar's native title.
- Made the web root fill the host; search and the footer stay visible while the task workspace scrolls. New-list entry is contextual, supports Escape, and stays on one row at 360 px.
- Preserved the extracted task renderer and original menu-bar template asset. Tag text now has distinct light/dark colors; tag clicks also update the search field.
- Validation: build and typecheck passed; 270 unit tests passed (shared UI's 25 rerun after palette change). All 11 WebKit scenarios passed across the final suite and targeted rerun. The layout test covers theme text colors, contextual list entry, narrow width, overflow and fixed footer. Dark/light screenshots at 420×588 were visually inspected. Playwright's animation-disabling screenshot option reset theme transitions in WebKit; captures now wait for rendered colors and use normal animation behavior.
- Installed service returned HTTP 204, served the rebuilt asset, and its plugin emitted the original template icon plus the popover URL. Touched the installed wrapper to request watcher refresh. Native SwiftBar appearance/focus has not been re-inspected automatically; closing/reopening loads the rebuilt UI. No modifications to the user's SwiftBar fork.

## List menu and panel consistency — 2026-09-27

- Default-list ellipsis previously had no entries because Rename/Delete are protected. All lists now expose Add task, Collapse/Expand, and Hide/Show completed; custom lists retain Rename/Delete. Menu controls isolate their pointer/keyboard events from list dragging.
- Backups and Trash share PanelHeader with the same back arrow, icon, title and spacing. Backups scrolls beneath its fixed header. Removed the toolbar separator and extra spacing.
- Build, typecheck and 270 unit tests passed. All 13 WebKit scenarios passed across the suite and targeted menu rerun; new checks exercise default/custom list menus, editor focus, keyboard opening, collapse and completed visibility, renaming, panel back navigation, identical header geometry and equal toolbar spacing. Both panel screenshots and the list menu were visually inspected. Native host verification remains a user check.

## Help panel restored — 2026-09-27

- Restored the original metadata, date, search-filter and editing reference in shared HelpPanel, with the same header as Trash/Backups and independently scrolling content. Added a labeled CircleHelp toolbar button, Command-/ toggle, Escape dismissal and return focus. Keyboard hints omit unsupported Electron features and include Command-Enter to save.
- Build, typecheck, 270 unit tests and all 14 WebKit scenarios passed. New coverage checks original content, scrolling beneath the fixed header, toolbar/back/keyboard navigation, focus restoration and retained saved tasks. Light/dark screenshots were visually inspected. Native SwiftBar keyboard behavior still requires a real-host check.

## Original toolbar actions restored — 2026-09-27

- Restored ChevronsDownUp for collapse/expand all lists and ArrowUpDown for one-shot system sort, in the original toolbar order. Both reuse the existing store actions. Collapse action labels reflect the current state. Command-E/Command-J work outside editors and inputs; Help documents them.
- Build, typecheck, 270 unit tests and all 15 WebKit tests passed. New coverage verifies persisted priority sorting and collapsed states, mixed expanded/collapsed lists, both shortcuts, and a 360 px toolbar without overflow. Full toolbar screenshot visually inspected.

## Shortcut tooltip hints — 2026-09-27

- Action tooltips render shortcut keys through the existing Kbd/KbdGroup components, derived from aria-keyshortcuts: collapse/expand, system sort, Toggle help, undo/redo, and list-form submit/cancel. Command and Shift use macOS symbols. Actions without shortcuts retain plain labels.
- Added app-level Command-Z/Command-Shift-Z and matching Help hints; handlers leave inputs, contenteditable editors and dialogs alone. Build, typecheck and 270 unit tests passed. All 16 WebKit scenarios passed across the suite and targeted tooltip rerun; checks include individual keycaps, non-shortcut actions, list-form hints, actual undo/redo and input isolation. Tooltip screenshot visually inspected.

## Preview shortcut — 2026-09-27

- Command-P toggles media previews using the same callback as the toolbar button, including persisted preference and per-media override reset. Like the other task-view shortcuts, it leaves editors/inputs/dialogs alone. Tooltip keycaps and Help include Command-P.
- Build, typecheck, 270 unit tests and all 17 WebKit scenarios passed. New test exercises image preview visibility, repeated keyboard/button toggling and reload persistence; tooltip test covers Command-P keycaps.

## Native clipboard keyboard routing — 2026-09-27

- User confirmed only keyboard shortcuts fail; right-click Copy works. Root cause is SwiftBar lacking a standard Edit menu, so AppKit does not dispatch Command-C/Command-V to the active WebKit responder. No Tasker renderer or clipboard-service changes were needed.
- Fixed in Carlos-err406/SwiftBar PR #2, commit 76dad9ab90587984267774ff1cf2fc116893dc06: install Cut/Copy/Paste/Select All menu actions at startup, preserve existing menus and nil responder-chain targets, avoid duplicates.
- Native AppKit/WKWebView reproduction tested both textarea and contenteditable controls. Before: keyboard copy and paste both false. After using the actual patched menu code: both true. Test clipboard contents were restored after each run. SwiftBar CI tests and universal app packaging passed (run 36354755249). Installed and restarted `/Applications/SwiftBar.app`; verified its signature and binary SHA-256 `47ddc66918f3d1524b4470c56f713b42fcaf4442654b2f0b6d93bd2dd490d3a2` matches the artifact. Previous bundle retained at `/private/tmp/SwiftBar-before-clipboard-76dad9a.app`. SwiftBar restarted and Tasker health returned HTTP 204. The user subsequently confirmed actual popover keyboard copy/paste works, including pasted images.


## Stable media and native image opening — 2026-09-27

- Inspected task `vjt` read-only in the separate SwiftBar database; its image is a managed `/attachments/<uuid>` reference. The original CLI could not open its legacy database; no original task data was changed.
- Reproduced ID-copy flicker in WebKit: showing the copy status detached the existing image/YouTube DOM nodes. Moved Markdown component definitions out of the render function and passed current callbacks/preview settings through context. Status changes now retain media state; source changes still reset the relevant preview. ID-copy feedback now waits for clipboard success and reports failure.
- Removed Copy image path. Both image click and Open image export managed BLOB bytes to a private temporary directory and invoke the default macOS viewer. Only authenticated managed references and existing HTTP(S) links are accepted. Native-open failures are visible in the UI; normal service shutdown removes disposable files. The SQLite BLOB remains authoritative.
- Build and typecheck passed; 271 unit tests and all 19 WebKit scenarios passed. The ID regression failed before the fix and passed afterward, including status timeout. Image tests exercise both UI entry points, menu removal, error feedback, exact exported bytes, file permissions, blocked arbitrary paths, authentication and shutdown cleanup. Native viewer invocation is replaced with a recorder in automated tests; opening Preview from the actual SwiftBar popover remains a user check.


## Pasted-paragraph line breaks — 2026-09-27

- Reproduced the reported E-Myth example in WebKit by inserting both plain text and rich-text paragraph DOM, positioning the caret within the pasted text, pressing Enter twice, then Command-Enter. Plain text passed; paragraph paste failed because getPlainText concatenated adjacent `<p>` elements. Reopening Edit rebuilt the same text with supported `<div>` elements, explaining the different result.
- Added paragraph boundaries to both text extraction and DOM caret-position mapping in the shared contenteditable helpers. No changes to parsing, rendering, storage, or save shortcuts were required. Existing tests filled multiline text directly, so they did not exercise paragraph splitting after paste.
- Both new regressions pass and check exact stored line breaks, reload, the title/body split, reopening Edit, and saving an additional line. Build, typecheck, 271 unit tests and all 21 WebKit scenarios passed. Real SwiftBar keyboard confirmation remains distinct from automated WebKit evidence.


## Scrolled task editing and Escape — 2026-09-27

- Read `z0z` from the SwiftBar database without modifying it. Reproduced editing a long task at the bottom of a scrollable list: the editor disappeared before it could retain focus. The old flow mounted an empty editor while the context menu still owned focus, then populated/focused it after a fixed 50 ms timeout. That temporarily shortened the row and exposed the blur-to-save path during menu focus restoration.
- Edit now waits for the context menu's close-autofocus event, then initializes the content and focus in a layout effect before paint. Removed the timing-based handoff; focus uses preventScroll. The regression checks retained focus/content, scroll position, saving, and persistence after reload.
- Existing-task and new-task Escape handlers explicitly prevent the default action while canceling. Tests verify the cancelable key event is consumed, keyboard Escape discards edited text, canceled drafts create no task, and stored content remains unchanged.
- Build, typecheck, 271 unit tests and all 23 WebKit scenarios passed. An isolated native NSPopover/WKWebView probe left the popover open after handled Escape, but also did so before preventDefault; it did not reproduce the user's native dismissal and is not claimed as proof of that original symptom. Actual SwiftBar Escape behavior remains a host confirmation.


## Claude list paste and Shift-Enter — 2026-09-27

- User clarified the remaining line-break loss occurs after copying from Claude.app and pressing Shift-Enter. The previous paragraph-only reproduction was incomplete. Inspected clipboard formats and HTML structure without printing copied text: Claude supplied `<ul><li><em><strong>…</strong></em></li></ul>`.
- Reproduced with that list structure in WebKit, and with native Command-V/Shift-Enter in an isolated WKWebView using the existing clipboard without changing it. WebKit emitted `insertParagraph` and split list items even for Shift-Enter. Before the fix, the native probe reported visibleBreaks=1 but savedBreaks=0 and liveBreaks=0; the extractor ignored `<li>` boundaries.
- Text extraction and caret mapping now recognize list-item boundaries alongside div/paragraph boundaries. The identical native probe then reported visibleBreaks=1, savedBreaks=1 and liveBreaks=1. No parser, task data or clipboard contents were changed.
- Expanded the existing persistence regression to six combinations: plain text, paragraphs and the observed Claude list format, each with Enter and Shift-Enter. Both list cases failed before the fix; all six pass afterward through Command-Enter, reload and later editing. Build, typecheck, 271 unit tests and all 27 WebKit scenarios passed.


## Restore collapsed lists before first display — 2026-09-27

- Reproduced startup showing an expanded list before its saved collapsed preference arrived. The store publishes list names before asynchronously loading per-list preferences, and the UI ignored its initial loading flag.
- The task workspace now waits for the initial load before mounting list sections, with aria-busy during that wait. Each list's first rendered state includes its saved preferences and tasks; normal user-triggered CSS transitions remain unchanged.
- Added a WebKit regression that persists collapse, reloads while holding the preference response, observes every initial list state and transition, and verifies there is no expanded state or startup collapse animation. A subsequent click must still produce a grid-template-rows transition. It failed before the fix and passed after. Build, typecheck, 271 unit tests and all 28 WebKit scenarios passed.


## Scope decisions, search shortcuts, and deeper interaction checks — 2026-09-27

- Recorded the user’s MVP exclusions and future bucket in `docs/scope-decisions.md`; the repository guidance links to those decisions. Clarified that Google setup requires one developer-configured Desktop OAuth client JSON, while end users connect through Google consent.
- Added Command-K to focus/select search (including from other panels), Command-R to refresh task data without navigation, and Escape to clear focused search and cancel its pending debounce. Editor Command-K keeps its Markdown link behavior. Search tooltips use keycap components and Help documents the shortcuts. No list-filter dropdown was added.
- Build, typecheck, and 271 unit tests passed. All 31 WebKit scenarios passed across the full suite and a targeted rerun correcting the new test’s expected existing Markdown link template. New coverage verifies keyboard search/refresh, pointer task/list reordering, persistence, undo/redo, and drag cancellation.
- A native AppKit NSPopover/WKWebView probe loaded the actual built UI against a temporary service/database with standard Edit menu routing. All 11 checks passed: native text paste, select/copy, cut, Shift-Enter and Command-Enter, Escape retaining the popover, Escape discarding edits, PNG paste/storage/rendering, Command-K, Escape clearing search, Command-R without navigation, and close/reopen persistence. Clipboard contents were restored. This tests the real UI inside a native harness; direct interaction with the installed SwiftBar popover remains distinct. The disposable probe is `/private/tmp/tasker-native-integration.swift`.

## Bundled Google application configuration — 2026-09-27

- Added the user-authorized public Desktop OAuth identity to the service build, copying only client ID and optional desktop client secret. No account grants or raw downloaded client JSON were added. Resolution prefers explicit `TASKER_GOOGLE_CLIENT_JSON`, then data-directory `google-client.json`, then the bundled identity; malformed overrides fail visibly instead of silently changing apps.
- Added `pnpm release:archive` with explicitly selected runtime inputs and dependency manifests. The prebuilt archive excludes raw JSON credentials, account tokens, runtime capabilities, databases, snapshots, symlinks, and installed dependencies. It does not publish anything. Node/pnpm and the supported SwiftBar host remain prerequisites.
- Build, typecheck, 276 unit tests, and all 31 WebKit tests passed. New tests cover fresh-install fallback, both override levels, invalid/missing overrides, Desktop-only validation, app-field extraction, and release exclusion of seeded private files and symlinks. The existing service-launch test now uses a unique dummy OAuth identity to avoid accessing a real Keychain grant after bundling.
- Extracted `release/tasker-swiftbar-0.1.0-macos.tar.gz` into a fresh temporary directory; `pnpm install --offline --frozen-lockfile` succeeded. Its real service started with bundled Google configuration and no local JSON, served the UI, and passed an installer dry run using temporary paths. The isolated probe disabled account-grant lookup and automatic backups so it made no Google calls. Inspected the final archive entries for local-state exclusions.
- Refreshed the installed service and confirmed health, Google configured, and the existing account still connected. The local client override and account grant were preserved. Google audience/branding publishing was not changed.
- Updated the Google guide to record the user's confirmed live consent, two uploaded backups, and successful restore. Those results do not independently verify token-refresh or revocation paths.


## Canonical Tasker repository — 2026-09-27

- Copied the complete current SwiftBar source and assets into the user-provided clean checkout `/Users/carlos/Developer/tasker`, retaining its origin `https://github.com/Carlos-err406/tasker.git`. The original app is reference-only at `https://github.com/Carlos-err406/tasker-ref.git`. The prior staging checkout remains intact. No Git history or application data was copied into the clean repo.
- Verified 157 unchanged files byte-for-byte; four documentation files were updated for the new repository location and reference URL. Installed dependencies from the existing pnpm cache and rebuilt the release archive in the new checkout. Build, typecheck, 276 unit tests, and 31 WebKit tests passed there.
- Reinstalled the LaunchAgent and SwiftBar wrapper from the new path. Confirmed both point to the new checkout, the service is healthy, and the existing Google account remains connected. The existing app data directory is unchanged. Source files remain uncommitted; no remote publication was performed.


## Initial repository publication — 2026-09-27

- User requested the initial push to `Carlos-err406/tasker`. Confirmed the destination is the user-designated empty public repository. Initial publication uses `main` because no base branch or previous history exists.
- Reviewed the 161 candidate source files for excluded user state, raw OAuth JSON, private keys, and recognizable account tokens. The previously authorized public Desktop OAuth identity is intentionally included. Generated runtime archives and installed dependencies remain ignored.
- Validation immediately before publication: build, typecheck, 276 unit tests, and 31 WebKit tests passed from the canonical checkout; the installed service points there and retains the working Google connection.


## Resolve initial GitHub push protection — 2026-09-27

- GitHub rejected the initial unpublished commit because it classified the intentionally public desktop client ID and client secret as credentials. No bypass was used.
- Replaced the tracked OAuth module with an unconfigured placeholder. Build-time injection now reads `TASKER_GOOGLE_BUILD_CLIENT_JSON`, validates Desktop app format, and emits only app identity fields into ignored compiled output. Official runtime archives still include the app identity and require no user JSON setup; source builds need a developer configuration.
- The build clears stale defaults when no input is provided. The release command rejects missing bundled configuration. Added coverage for allowed-field extraction, grant exclusion, stale-default removal, and invalid/missing inputs. The rejected initial commit will be replaced before retrying publication so its credential values do not remain in the pushed history.

- After the adjustment, the configured release build, typecheck, and 277 unit tests passed. The existing 31 WebKit tests had passed immediately before this build-only change. Verified actual client ID/secret values are absent from all Git candidates and remain present in the ignored generated release module.


## One-command macOS installer — 2026-09-27

- Added `install.sh` for curl installation and updates on macOS 13.5+ (Intel/Apple Silicon). It checks SHA-256 for Tasker and pinned Node downloads, SHA-512 for pinned pnpm, prepares dependencies before service activation, and keeps task data separate from managed app versions. Failed activation restores the prior integration files and attempts to restart the old service. A generated uninstall entry point retains user data.
- User approved installing the SwiftBar fork when absent. The companion is the existing CI-tested universal build at commit `76dad9ab90587984267774ff1cf2fc116893dc06`, with its MIT notice included. The artifact checksum and binary hash match the currently working installed app. The installer preserves existing SwiftBar installations and macOS security controls.
- Build, typecheck, 281 unit tests, and 31 WebKit tests passed. ShellCheck and shell syntax validation passed. New tests cover version validation, unsupported platforms, checksums, archive roots, and rollback file preservation. Relevant tests were rerun after final installer adjustments.
- A real isolated installation downloaded and verified private Node/pnpm, installed production dependencies, and started a separate healthy LaunchAgent with temporary data and a dummy OAuth identity. A repeat installation retained a fixture task and replaced the current-version symlink correctly. Generated uninstall removed the test service/plugin and preserved its database. No production app data or Google grant was used in these checks.

## Combined task and content menus — 2026-09-27

- Right-clicking images, YouTube previews, direct videos, links, or code blocks now shows content-specific actions followed by the owning task's complete menu. A shared task-menu context keeps edit/copy/subtask/move/status/delete behavior consistent without duplicating callbacks.
- Nested menus share the existing close-before-edit focus handoff. Plain task menus remain free of content-specific actions; standalone Markdown outside a task retains its content-only menu.
- Build, typecheck, and 282 unit tests passed. All 31 existing WebKit scenarios passed; five added scenarios passed after fixing fixture setup (exact Markdown seeded through RPC and clipboard stubs installed across reload). Coverage checks one visible menu, content actions, task text copying, status submenu selection, focused editing/cancel, and deletion of the correct task. Direct-video coverage exercises its fallback preview; native SwiftBar interaction remains a separate manual check.

## Offline Android preview and desktop tag appearance — 2026-09-28

- Added an offline Android app using the shared task/list operations, parsers, React editor and native private SQLite storage. Managed images remain SQLite BLOBs. The preview has its own application data and does not connect to Mac tasks or Google accounts. Existing SDK/Gradle caches were reused without installing an emulator, IDE or NDK.
- Installed Tasker Preview on the connected Samsung SM-S711U1 (Android API 36), preserving its preview data on subsequent installs. Physical-device checks covered list/task creation, multiline editing, metadata search, status and undo, native image picker cancellation, attachment storage/rendering, image preview, Android Back, keyboard-visible Save controls, and force-stop/relaunch persistence. These were interactive ADB/WebView checks, not an automated native test suite.
- The mobile button size rule inflated task tags. At the user's request, tags now retain the desktop font, icon, padding, color and pill styling; mobile minimum-height and minimum-width overrides exclude them. Verified the rendered chip and tap-to-filter on the phone.
- Final shared verification: pnpm build, pnpm typecheck, all 295 unit tests and all 36 WebKit scenarios passed. Android assembleDebug and lintDebug passed. Lint retains three warnings: a newer Gradle patch is available, JavaScript is enabled for the bundled UI, and the Android 12 extraction rules do not cover API 30 (allowBackup is false). The Vite bundle-size advisory remains.
- Native checks cover this connected device; WebKit checks do not prove SwiftBar host lifecycle behavior. The Android preview does not include sync, backups, notifications, touch drag reordering or store publication. Source changes remain local; build/install instructions and limitations are in apps/android/README.md.

## Shared list picker — 2026-09-28

- Replaced stacked, collapsible sections on Mac and Android with one shared task workspace and a list picker. The selected list is remembered in local UI storage; empty lists remain selected. Search and system sort apply to the selected list. Creation selects the new list, renaming follows the new name, and deleting a selected list falls back to the default.
- Removed collapse buttons, collapse menus, Command-E and list-header dragging. List options retain completed-task visibility, rename and delete, with move-up/down actions preserving picker ordering and undo. Existing database collapse fields remain compatible with older builds but are ignored by this UI.
- Cross-list relationship navigation selects the destination, clears search and reveals completed targets. List switching and creation are disabled during an open draft. Keyboard selection restores focus to the picker. Refreshed results are applied atomically, and older search responses cannot overwrite newer results.
- Verification found and resolved Rename's menu-focus handoff and a desktop search tooltip that intercepted clicks on the picker. Build, typecheck, 295 unit tests and all 40 WebKit scenarios passed. The browser suite covers selection persistence, empty lists, scoped search and tag filtering, rename/delete fallback, ordering/undo, relationship navigation, stale searches, keyboard selection and draft protection, alongside existing task/editor regressions.
- Rebuilt and installed the Android preview without clearing data. On the Samsung device, checked switching, scoped search, empty states, cancelling a draft, native Back, and selection/task persistence after force-stop/relaunch. Captured and inspected desktop and phone screenshots. Refreshed the installed SwiftBar plugin; actual interaction inside its native popover remains a separate manual host gate from the WebKit suite. No release or remote publication was performed.

## Desktop toolbar iteration — 2026-09-28

- Moved the desktop list selector to the top-left app toolbar, replacing Tasks. The top-right plus creates a task in the selected list; completed-task visibility joins previews, sort, trash, backups and help there. The desktop task workspace no longer renders a list header or a separate list-options menu.
- The selector contains Create list and selected-list rename, delete and ordering. Create/rename forms open after the menu releases focus; failed operations retain the form. Picking the already selected list returns from auxiliary panels, and Add task works from those panels. Tooltip copy is View trash, View backups and View help; clicking Help opens the view while the existing keyboard shortcut retains its toggle behavior.
- This iteration leaves the Android source layout and installed preview unchanged. Shared workspace changes are optional props that retain the existing mobile defaults.
- Build, typecheck and 295 unit tests passed. Forty browser scenarios passed in the full run; the new toolbar/tooltip scenario passed on a targeted rerun after its hover sequence was adjusted to wait for tooltip closing animation. The selector-management scenario was also rerun with a fully visible menu screenshot. All 41 scenarios are covered. Inspected 420px and 360px desktop screenshots, including long list names. Refreshed the installed SwiftBar plugin; the actual native popover interaction gate remains distinct from browser validation. No publication was performed.

## Desktop list-name spacing — 2026-09-28

- Removed Move list up/down from the desktop selector while retaining the existing list order. Create, rename and delete remain in the picker.
- Compacted the app-control buttons and their spacing, giving the picker 18 additional pixels while reserving a 12px gap before the controls. Long names retain ellipsis and a full-name hover title. The supplied name, finance books to download, fits fully at 420px; the toolbar also remains within a 360px viewport.
- Build, typecheck, all 295 unit tests and all 41 WebKit scenarios passed. Inspected the picker-menu, long-name and narrow-toolbar screenshots. Refreshed the installed SwiftBar plugin; browser checks do not certify native focus/lifecycle behavior. Android source and installed preview were not changed in this follow-up.

## Mobile toolbar iteration — 2026-09-28

- Moved the desktop picker into the shared UI package and used it at the top left on Android. Both platforms retain the same create/rename/delete actions and omit list up/down controls. Android no longer shows the Tasker heading, tagline, separate New list row or list header.
- Mobile Add task and completed visibility sit at the top right; the adjacent App options menu holds previews, system sort, View trash and View help. The header keeps a 12px separation from the picker, 44px touch targets and ellipsis for long names. Pending count moved to the footer. Forms retain focus, disable conflicting actions while editing, and support native Back cancellation. Add task works when returning from auxiliary panels.
- Build, typecheck, 295 unit tests and all 41 desktop WebKit scenarios passed after extracting the shared picker. Android assembleDebug and lintDebug passed using existing cached SDK/Gradle/JDK tools. No emulator, IDE or new build toolchain was installed.
- Installed with adb install -r on Samsung SM-S711U1, preserving the existing Android QA task and attachment data. Physical-device WebView/ADB checks covered create/rename/delete, default-list fallback, draft protection, task creation/edit/save with the keyboard present, long-name layout, scoped search, preview toggling, completed visibility, system sort, same-list return from trash, Add task from help, and native Back from forms, menus and help. Force-stop/relaunch retained the selected list and edited task. Removed the temporary fixture list and returned to Android QA, confirming the original task remains.
- Inspected phone screenshots under apps/android/test-results, including the native device capture, long-name toolbar, app menu and keyboard-visible editor. The native screenshots and checks apply to the connected Samsung device; desktop SwiftBar focus/lifecycle remains a separate host gate. No release was published.

## Mobile ergonomics and task actions — 2026-09-28

- Moved the list picker, Add task and App options to the bottom. Completed visibility and undo/redo join previews, sort, trash and help in the upward-opening app menu. Task checkboxes now render at 20px with an expanded hit area; ID buttons no longer inherit the generic 44px minimum.
- Added full-screen touch Add/Edit screens that keep the shared metadata, Markdown, image and persistence paths. The underlying workspace is inert while editing; attachment, Cancel and Save stay above the keyboard. Error messages remain visible over the editor. Desktop editors remain inline.
- Horizontal swipes in either direction reveal a bottom task-action sheet; neither direction changes a task automatically. Edit, Move, Complete/Mark pending and Trash are also available from a three-dot button. Vertical scroll and interactive task content remain separate from swipe recognition. Fixed a generated-click suppression bug that could swallow the first Save after swipe-to-edit, and removed inherited desktop dialog translation from the bottom sheet.
- Replaced the separate mobile help with the shared desktop metadata/date/search/editing reference plus touch instructions. The original Android QA image was a valid 1x1 fixture, not a failed preview. Verified inline rendering and image-viewer opening with a 1079x2202 PNG; retained the Image preview check fixture for visual review while preserving the original Phone persistence check task.
- Build/typecheck and 295 unit tests passed. All 41 desktop browser scenarios passed using the already cached WebKit 2336 via TASKER_TEST_WEBKIT_EXECUTABLE; the default WebKit 2248 executable was no longer in the cache. No browser or Android toolchain download was needed. Android assembleDebug/lintDebug passed, retaining the existing Gradle/lint advisories.
- Physical-device checks on the Samsung covered both swipe directions, vertical scrolling, first-tap Save after swipe/Edit, full-screen editor focus, keyboard-visible actions, native Back cancellation, shared help, Complete/Move/Trash and Undo, compact checkboxes, and normal-size image persistence across installation and process restart. Inspected native screenshots because CDP captures can show stale WebView compositing during keyboard transitions.
- Final installed-build validation confirmed both swipe directions in sequence, with the sheet spanning the viewport and every action visible above the system navigation area. Native captures are apps/android/test-results/mobile-actions-native.png, mobile-editor-native.png and mobile-help-native.png. Returned the app to its task view after review.

## Swipes starting on images — 2026-09-28

- Reproduced the reported issue on the connected phone using task nbg: a horizontal gesture starting directly on its IMG element opened no task actions. The touch gesture guard explicitly excluded images.
- Removed only the image exclusion. Existing horizontal intent detection and capture-phase click suppression allow image-origin swipes without opening the viewer; ordinary taps still reach the image handler. Buttons, links, editors and video controls retain their exclusions.
- Rebuilt and installed with adb install -r. Verified both left and right swipes starting on nbg's image open Task actions, a normal image tap opens only the viewer, and a vertical image gesture opens neither. No task action was executed and nbg's content remained unchanged. Build, typecheck, 295 unit tests and Android assembleDebug passed.
- All 41 WebKit browser scenarios also passed using the existing cached WebKit executable.

## Swipe overflow above the mobile footer — 2026-09-28

- Reproduced on task nbg: translating its row right increased the workspace scrollWidth from 411 to 461 CSS pixels, creating the horizontal scrollbar above the pending-count footer.
- Added overflow-x: clip to the mobile swipe row. The translated content is clipped without making the row a scroll container or restricting its vertical overflow.
- Rebuilt and installed the Android preview preserving data. On the phone, verified workspace scrollWidth equals clientWidth and scrollLeft remains zero throughout both swipe directions. Both gestures still open Task actions, image taps still open the viewer, and computed vertical row overflow remains visible. Inspected a native screenshot captured while the right swipe was held; the footer scrollbar is absent.
- Workspace build, typecheck, and all 41 WebKit scenarios passed. Unit checks covered all 295 tests: one plugin test initially raced the concurrent build while dist/index.html was being replaced; both plugin tests passed when rerun after the build completed. git diff --check passed.

## Whole-row mobile swipes — 2026-09-28

- Reproduced the hidden-preview failure on task nbg. The gesture handler excluded buttons and other controls, so removing only the image exclusion had left the same underlying issue elsewhere in the row.
- Recognize touch gestures in the row's pointer capture handlers, regardless of the child element. Keep portaled editors/viewers outside the gesture surface. Suppress the click generated by any recognized horizontal drag, including drags below the action-sheet threshold; ordinary taps and vertical scrolling retain their behavior.
- Added nine isolated WebKit regression scenarios covering both swipe directions over text, nested buttons that stop pointer propagation, links, checkboxes, images, video, and the actual collapsed preview component. Also cover tap suppression, ordinary taps, cancellation, vertical movement, and portaled controls.
- Rebuilt and installed the Android preview preserving data. Trusted device touch checks passed for nbg's hidden preview in both directions, its expanded image in both directions, checkbox, ID, action trigger, and hide-preview button. Verified normal preview/image taps, short checkbox drags, and vertical movement from the hidden preview. Restored the hidden preview and confirmed task text/status remained unchanged.
- Workspace build, typecheck, all 295 unit tests, all 50 WebKit scenarios (41 existing plus nine new), Android assembleDebug, and git diff --check passed.

## Full mobile actions drawer — 2026-09-28

- Replaced the drawer's separate action subset with shared task action definitions used by desktop context menus. Included Copy ID/text, Create subtask, destination lists, all four statuses with the current choice marked, and both deletion choices for parent tasks. Registered the rendered media/link/code actions in Content actions so disabling long-press menus does not remove access to them.
- Added 220 ms entrance and 180 ms exit slide animations, matching overlay timing and honoring reduced motion. Deferred row mutations and editor/viewer handoff until drawer dismissal completes; clipboard commands retain the originating click's user activation.
- Disabled mobile context-menu triggers, prevented native row context menus/text selection, and suppressed release clicks after long holds. No multiselection or batch-action implementation was added.
- Installed the rebuilt preview preserving data. On nbg, verified full status/move menus, image content commands, image viewer and focused editor handoff, Create subtask with the parent reference (cancelled), both hidden-preview swipe directions, and animated dismissal. Native 1.2-second holds on title, checkbox and hidden preview opened no menu and changed no task data. Inspected the native drawer screenshot and checked its settled bounds against the viewport.
- Validation passed: workspace build and typecheck, all 295 unit tests, all 54 WebKit scenarios (including drawer parity, media commands, long-hold suppression, animations and reduced motion), Android assembleDebug, and git diff --check. Desktop menu behavior was covered by WebKit; this turn did not repeat the native SwiftBar lifecycle gate.

## Swipe visual feedback — 2026-09-28

- Moved the task ellipsis into the translated task surface so all row content moves together. Added a muted backing surface beneath the opaque task surface, revealed progressively by either swipe direction.
- Rebuilt and installed preserving data. On nbg, measured matching 50-pixel movement of the title and ellipsis in both directions, in light and dark themes. Confirmed the workspace remained 411 pixels wide with no horizontal scroll, both swipes still opened the drawer, and the ellipsis still worked when tapped. Inspected native screenshots during the gesture, restored the original theme behavior, and left task data unchanged.
- Workspace build/typecheck, all 295 unit tests, all 54 WebKit scenarios, Android assembleDebug, and git diff --check passed.

## Android local and Google Drive backups — 2026-09-28

- Extracted the existing desktop Backups view into the shared UI package, with injected management operations. Added View backups to Android app options, phone-sized controls, loading/error/busy states, and a restore confirmation. Await task/undo refresh before re-enabling mobile controls; polling does not overlap or accumulate during Google consent.
- Added native private snapshots with the same SQLite/manifest format, checksums and embedded image data as Mac. Validate schema, integrity, foreign keys and attachment references before restore. Create a safety snapshot and copy all tables in one rollback-safe SQLite transaction. Retain seven automatic snapshots, preserve manual/safety snapshots, and schedule due backups while the app is foregrounded. Account credentials remain outside the task database and WebView.
- Added Google Play services authorization with drive.file, bounded streaming Drive uploads/downloads, upload verification/deduplication, retry and disconnect handling. Android cloud retention only prunes its own automatic snapshots; Mac source now excludes Android-marked snapshots from its legacy retention group.
- With the user's explicit approval, registered the Android development client in the existing Tasker Cloud project. The user selected their account and completed phone consent. Verified an automatic phone snapshot and a manual phone snapshot uploaded successfully; the phone lists those plus the existing Mac snapshots. Verified the connection survives app replacement/restart, the three pending tasks remain, and the 411px workspace has no horizontal overflow. No real-user restore was performed.
- Native isolated tests: 8 snapshot/restore cases (images/undo/safety, confirmation, corrupt checksum, missing images, executable/schema changes, injected failure rollback, retention, unsupported imports) and 6 fake-HTTP cases (401/403, pagination/retention, pagination cycles, deduplication, failed writes, oversized downloads), all passing on the physical phone. Test traffic cannot reach Google. Mac's real backup validator accepted a copy of the phone snapshot; the temporary copy was removed afterward.
- Workspace build/typecheck and 297 total unit tests passed (296 in the full run, then the Android suite with its added undo-reload regression). All 54 WebKit scenarios passed; after the final shared-panel refresh adjustment, the actual image restore/safety recovery and panel-header cases passed again. Android assembleDebug/assembleDebugAndroidTest/lintDebug and git diff --check passed. Final Android APK installed with data preserved. Native SwiftBar lifecycle was not repeated; the Mac retention source change is not a published release. Sync remains the next separate phase.

## Backup branding, ordering and upload completion — 2026-09-28

- Added Google's current G artwork from its published Identity asset bundle to the shared Drive heading and connect/reconnect control. The asset is bundled locally, with source attribution; both themes retain the original colors on white.
- Explicitly sort local and cloud snapshots by parsed timestamps in the shared panel and native/Mac providers. Time-zone offsets and differing fractional-second formats no longer affect newest-first ordering. Mac upload processing now starts with the most recent snapshot.
- Fixed the desktop active-promise assignment race: synchronous snapshot validation failures previously cleared active before its already-completed promise was assigned, leaving uploading stuck. Publish active before work starts; success, failure and retry regressions now cover the lifecycle. Both platforms update the displayed completion timestamp only after the whole job finishes.
- Android manual upload now returns the completed job's status, matching desktop. The shared panel applies that result immediately and shows an explicit in-flight state while waiting; automatic jobs refresh once per second. Cancelling an Android activity releases completion waiters so shutdown cannot strand a pending request.
- Added three isolated coordinator tests and six desktop/mobile browser cases for logo loading, local/cloud ordering with time-zone offsets, manual success/failure returning to idle, and background completion. Unit suite: 300 passing. Workspace build/typecheck, Android build/lint and 14 isolated native tests passed. The installed Mac service was restarted gracefully with settings and account grant preserved; a real upload through its shared UI completed and re-enabled Upload now. Android was replaced with adb install -r, preserving data and its connection.
- Final verification: all 60 WebKit scenarios passed. Live Mac and Android upload buttons returned to idle after actual Drive requests, with no alerts and existing grants retained. Physical-phone QA found SVG assets were served as octet-stream; added image/svg+xml for bundled SVG files and rebuilt/linted the native host. The three phone tasks were preserved. Desktop verification used the actual running service in WebKit; native SwiftBar focus/lifecycle was not re-tested.
- Follow-up: removed the logo SVG's white backdrop path and the image corner styling. The bundled logo now has a transparent background on both platforms. Rebuilt both UIs and installed the Android update with data preserved; build/typecheck, all 300 unit tests and both logo/order browser checks passed. Verified SVG rendering in dark-theme desktop WebKit and on the phone, restoring the phone's system theme afterwards.

## Image thumbnails in mobile Content actions — 2026-09-28

- Added an optional resolved image preview URL to the existing media-action registration. Content actions renders a 48px thumbnail beside each image entry, preserving label and image command behavior. Thumbnails mount only when their picker is displayed, including when inline task previews are collapsed; unavailable images get a fallback icon. Desktop context menus retain their existing presentation.
- Installed the rebuilt Android preview with existing data preserved. On the user's current Image preview check task (s6f), both separate images with the same label loaded as 48px thumbnails. Tapping a thumbnail opened Open image / Copy image; returning kept both entries. Left Content actions open on the phone, with the three pending tasks unchanged.
- Build, typecheck, all 300 unit tests, and Android assembleDebug passed. Added browser coverage for duplicate image labels, loaded thumbnails, unavailable-image fallback, thumbnail tap navigation, and preserving hidden inline previews.
- All 62 WebKit scenarios passed, including both new thumbnail cases and the existing full swipe/media-action coverage. git diff --check passed.

### Google Drive sync — 2026-09-28

- Implemented the user's selected behavior: latest recorded edit wins automatically; Android syncs while the app is open. Mac sync runs with its existing service. The shared engine syncs tasks, lists, ordering, relationships, trash and managed image BLOBs through immutable per-device Drive checkpoints. Backups remain separate.
- Added durable stable identities, logical revisions and deletion tombstones; atomic operation/undo/capture transactions; deterministic graph projection; local short-ID preservation; bounded validation and checksum verification; upload retries using the same pre-generated checkpoint ID; account binding; serial jobs and cancellation. Retain the newest two checkpoints per replica. Remote image garbage collection is deferred.
- Incoming changes wait while an editor is open. Actual remote changes invalidate incompatible local undo history; no-op polls retain it. Device identity/account/settings live outside portable snapshots. Restore forks the publication identity, pauses sync, and records the restored difference for a later explicit resume. Existing backup format/schema remains supported.
- Shared Sync view has Enable, Sync now, Pause, last success, pending/error state and the transparent Google SVG. Desktop opens it from Backups to preserve header space; Android exposes View sync in the bottom App options menu and in Backups. Restore confirmation explains that resuming publishes restored changes.
- Fixed a native locking hazard discovered during integration: backup work must wait for a bridge transaction without holding a monitor needed by the remaining transaction calls. A reentrant gate now spans the native transaction, with an instrumentation regression covering concurrent backup work.
- Verification: `pnpm build`, `pnpm typecheck`, all **334 unit tests** (254 core, 27 UI, 49 Mac, 4 Android), **64 WebKit E2E tests**, Android debug/test APK builds, native lint, and **17 physical-device instrumentation tests** passed. WebKit uses the already-installed `webkit-2336/pw_run.sh`. One initial full-suite LaunchAgent startup check timed out during concurrent work; its focused rerun and the subsequent complete suite passed. An initial E2E invocation used a missing default WebKit path; the complete run with the explicit executable passed.
- Real provider gate: using a temporary isolated Drive namespace, Android read a Mac-created checkpoint and Mac read an Android-created checkpoint under the same account. Removed those synthetic files after verification. Tokens remained in the existing native/Keychain adapters and were never printed or persisted in test scripts.
- Saved pre-install snapshots on both devices and safety snapshots on enable; replaced the debug APK without clearing app data and restarted the Mac service. Enabled sync on both devices. Initial merge preserved **25 tasks across 3 lists**, with identical winning records on both devices. Five shared image objects had identical SHA-256 digests; the phone retained one additional unreferenced local BLOB, as intended.
- Real round trips passed: phone editor create → Mac; Mac edit → phone; divergent edits while paused, resuming the phone first and Mac later, chose the newer phone edit on both; list rename, move, reorder, parenting, dependency, relation, cascading trash, scoped purge and list deletion reached the phone. Temporary QA tasks/list were removed through normal operations; existing trash was not cleared. No real-user backup restore was performed; restore/rebase paths were verified with isolated core, service and native fixtures.
- Physical phone Sync layout was inspected at its actual viewport. Browser checks prove shared UI behavior, and the real Mac service/Drive path passed; SwiftBar's native focus/close lifecycle remains a separate host gate. No release, signing change or publication was performed.
- Final restart gate: force-stopped/reopened Android and restarted the Mac LaunchAgent. Both resumed enabled and reported up to date with no errors or pending changes. All sync records matched, both retained 25 tasks, temporary QA tasks were absent, and the phone had no horizontal overflow. `git diff --check` passed; no credentials, runtime state, databases or APKs appear among tracked/untracked changes intended for source control.

### Android Check for updates / Update — 2026-09-28

- Added Check for updates to the bottom App options menu and a dedicated Updates view with installed version, progress, errors and bottom action buttons. A newer matching package changes the action to Update; a downloaded package can be retried through Install update after Android permission settings or cancellation.
- Native checks use the fixed public GitHub latest-release endpoint. Preview and production APK assets remain separate. HTTPS redirects are limited to GitHub asset hosts; downloads have time/size limits and verified SHA-256/size. APK package, increasing version and existing signing key are checked before granting Android's installer temporary read access. Added the install-from-this-app permission and a private FileProvider restricted to the updates cache directory. Installation still requires Android confirmation.
- Replaced fixed Android versionCode=1 with the documented monotonic version mapping (0.1.1 → 1001). No package version/tag, signing identity, credentials or release workflow was changed. The published v0.1.1 release has no Android asset; this is shown explicitly rather than offering the Mac archive or claiming a successful Android install.
- Verified `pnpm build`, `pnpm typecheck`, **334 unit tests**, **67 WebKit E2E tests**, Android debug/test APK builds and lint, and **23 native instrumentation tests**. New cases cover release selection, preview/production separation, downgrade/version limits, malformed/oversized assets, HTTPS redirect restrictions, package/signing checks, download-error recovery, permission instructions and bottom button positioning.
- Installed on the physical phone with `adb install -r`. Both live GitHub checks completed, the button returned to enabled, there were no displayed errors or horizontal overflow, all 25 tasks remained and sync stayed enabled. Inspected the actual phone Updates view. Download/install-available states use fixtures because no Android release is published yet; a real GitHub-to-installer replacement remains to be verified with the first signed Android release. No APK was published and no user install-source setting was changed. `git diff --check` passed.

### Shared About page — 2026-09-28

- Grouped installed version, update controls and project/open-source credits in a shared About panel. Desktop opens it from Help → About Tasker, preserving the compact toolbar; Back and Escape return to Help. Android opens it from the bottom App options → About Tasker menu, replacing the standalone Updates entry and retaining bottom update controls.
- Opening About reads local status only. Check for updates explicitly contacts GitHub. Android retains its verified APK download/install flow. Mac validates the stable release and complete archive/checksum assets, then offers View update with installation instructions through the existing release page. Numeric version checks prevent downgrade offers; coalesced checks, bounded responses and error recovery are covered by isolated tests.
- Verified `pnpm build`, `pnpm typecheck`, **339 unit tests**, **69 WebKit E2E tests**, Android `assembleDebug`, and `git diff --check`. Browser cases cover Help/About navigation, version and credits, host-routed links, explicit checks, available/unpublished updates, download failures and installation permission recovery. Native updater code was unchanged; native instrumentation was not repeated for this UI change.
- Restarted the local Mac service and installed the Android APK with `adb install -r`. Inspected screenshots from the actual phone and the live Mac service in WebKit. Both completed live GitHub checks and re-enabled the button; neither had horizontal overflow (411px phone, 420px Mac). Android retained all 25 tasks and enabled sync. Mac correctly reported current; Android correctly reported no published package. SwiftBar's native focus/lifecycle and an actual published Android upgrade remain separate gates. No release was published.
- Mobile Help follow-up: removed keyboard and editing shortcuts from touch Help, simplified instructions around taps/swipes and bottom controls, and moved About into Help to match desktop. Removed the standalone App options entry. Both About's back arrow and Android's system Back return to Help. Rebuilt and replaced the phone APK with all 25 tasks preserved; checked the real Help screen, absence of keycaps/shortcut sections, both return paths and no horizontal overflow. Workspace build/typecheck, all 339 unit tests and all 69 WebKit E2E tests passed.
- Panel cleanup: mobile Trash, Sync, Backups, Help and About now omit the task footer (pending count, list picker and app controls). Touch Controls is five short tips. Shared About displays the existing Tasker app artwork and an official, theme-aware GitHub SVG mark beside Source code & releases; Octicons attribution/license is included. Physical-phone checks verified every panel has no task footer or horizontal overflow and that Back restores task controls; all 25 tasks remained. Inspected Help/About screenshots on the phone and About in desktop WebKit. Workspace build/typecheck, all 339 unit tests and Android debug build passed. WebKit completed 68 scenarios; one encountered a temporary Not found response during the final asset rebuild and passed on a focused rerun after the build finished (69 verified total). Final APK installed with data preserved; no release published.

- Mobile Sync navigation follow-up: removed View sync from App options; the only entry is Backups → View sync. Sync’s back arrow and Android Back now return to Backups. Updated navigation documentation. Workspace build/typecheck, all 339 unit tests, three focused WebKit panel/sync cases, Android debug build and diff checks passed. Replaced the phone APK preserving all 25 tasks; verified the absent menu entry, Backups entry and both return paths on the physical device.

### Production Android signing and packaging — 2026-09-28

- Created a permanent production signing identity outside the checkout with private directory/file permissions, and stored its configuration in the encrypted repository Actions secret `TASKER_ANDROID_SIGNING_JSON`. Only the public certificate fingerprint is tracked. Release packaging fails without signing configuration and verifies the production package, version, non-debuggable flag and pinned signing certificate before writing the APK/checksum pair.
- Added `pnpm release:android`, the CI signing helper with temporary-key cleanup, and third-party notices in Android assets. PR/main checks build and lint Android without signing secrets. The stable-tag publishing job builds the signed APK; the publisher now requires and verifies both Mac and Android assets before publishing its draft. Missing or corrupt local Android artifacts fail before contacting GitHub.
- Registered the production package `org.tasker.android` and certificate in the existing Google project. The user completed consent in the production app. Google's test-user audience remains unchanged; general account availability is a separate release gate.
- Installed the verified, non-debuggable production app alongside Preview without removing Preview or its data. Enabled sync after consent: Mac, Preview and production checkpoints contained identical winning records, with **25 live tasks across 3 lists and 5 shared image objects**. Force-stopped/reopened production and confirmed tasks and the Google connection persisted. Created a post-migration local snapshot (6464 KB); its Drive upload completed and the button returned to Upload now.
- Verification passed: workspace build/typecheck, **344 unit tests**, **69 WebKit E2E scenarios**, signed `assembleRelease`/`lintRelease`, Android package/signature checks, release-version alignment and workflow YAML parsing. The exact CI signing helper also succeeded locally. An unsigned release build was deliberately rejected. One initial full browser run had an intermittent touch-action failure; three focused repetitions and the subsequent full 69-case run passed without UI code changes.
- No commit, tag or release was published. Hosted Actions execution and a real published GitHub-to-Android installer upgrade remain unverified. The published v0.1.1 release is still Mac-only; publication requires a new aligned version, release notes and a stable tag on merged main. SwiftBar native focus/lifecycle was not retested in this packaging work.

### Release 0.2.0 validation — 2026-09-28

- Aligned all five package versions and the SwiftBar plugin at 0.2.0 (Android versionCode 2000), with release notes and production Android installation/migration documentation.
- Revalidated the release source with workspace build/typecheck, 344 unit tests, all 69 WebKit scenarios, shell syntax/ShellCheck, version checks, and signed Android assembleRelease/lintRelease plus certificate/package verification. Source credential-pattern checks found no matches. The phone remains on production 0.1.1 for the published upgrade test.
- Hosted PR/tag CI, publication and the real Android update are the remaining release gates at this commit.
