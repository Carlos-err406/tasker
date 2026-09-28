# Implementation status — 2026-09-27

Initially implemented in `/Users/carlos/self-development/tasker-swiftbar`, branch `codex/swiftbar-mvp`. The canonical checkout is now `/Users/carlos/Developer/tasker`, with origin `https://github.com/Carlos-err406/tasker.git`. Original source tracked changes were preserved; no original task database or startup configuration was used.

| Unit | Result | Evidence |
| --- | --- | --- |
| U1: writable popover | Implemented; basic real-host check confirmed | SwiftBar 2.1.1 on macOS 26.5.1. User confirmed the saved task renders its table, rule and quote after reopening. Private session/Host/Origin tests pass. |
| U2: shared parser/storage | Implemented | 220 core tests, including original parser/query/undo cases plus BLOB storage. Explicit standalone-snapshot importer preserves the source bytes and reports omitted fields. |
| U3: renderer | Implemented; extended host check pending | Existing task/list/Markdown/editor/store logic extracted; 25 renderer helper tests and 8 WebKit E2E flows. Smart-dash delimiter regression fixed. Actual SwiftBar pasted-image/backup check has been requested. Clipboard copy and representative video playback have not been manually confirmed. |
| U4: local recovery | Implemented | Task/image restore, safety recovery, checksum/schema rejection, retention, and six child-process exits at restore boundaries pass. Automatic daily snapshots and explicit restore confirmation wired to UI. |
| U5: Google backups | Implemented; live provider verification deferred by user | Fake-provider tests cover PKCE/state, denied consent, expired grants, quota errors, incomplete uploads and cancellation. No Google client or account grant exists. User requested free setup documentation instead. |
| U6: installation/docs | Implemented and installed on current Mac | Isolated installer/removal smoke checks passed. Per-user LaunchAgent and managed plugin installed; health returns 204. Prototype tasks copied through SQLite backup into the app's independent data directory; prototype copy retained. Clean-machine and sleep/wake testing remain unperformed. |

## Validation

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

Google setup: `docs/google-setup.md`. Live consent/Keychain/cloud round trip is deferred until credentials exist; this is not presented as a verified production Google integration. Actual SwiftBar media/clipboard checks and clean-machine/sleep testing are listed above rather than counted as automated passes.

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
