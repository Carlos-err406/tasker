---
title: "feat: Android mobile app with home screen widget"
type: feat
status: active
date: 2026-03-17
deepened: 2026-03-17
brainstorm: docs/brainstorms/2026-03-17-mobile-app-android-brainstorm.md
---

# Android Mobile App + Home Screen Widget

## Enhancement Summary

**Deepened on:** 2026-03-17
**Research agents used:** 7 (Drizzle framework docs, Glance widget patterns, NativeWind + mobile UX, performance oracle, security sentinel, architecture strategist, learnings researcher)

### Key Improvements from Research
1. **No custom RawDriver needed** — Drizzle has built-in cross-driver `db.all(sql`...`)`, `db.transaction()`, and `db.run(sql`...`)` that work on both better-sqlite3 and expo-sqlite. Eliminates the entire `RawDriver` abstraction.
2. **Both drivers are synchronous** — confirmed: `expo-sqlite` with `openDatabaseSync()` produces `BaseSQLiteDatabase<'sync', ...>`, matching `better-sqlite3`. No async migration needed.
3. **Widget: custom Kotlin Glance + Expo config plugin** — `android-glance-widget-expo` has 1 star and is experimental. Write the widget natively with a custom config plugin instead.
4. **Widget sync via change listener** — use `expo-sqlite`'s `enableChangeListener` to decouple widget sync from mutation logic, instead of calling a sync function after every mutation.
5. **FlashList over FlatList** — `@shopify/flash-list` uses RecyclerView-like recycling, 2-5x better performance for 100+ variable-height task items.

### Institutional Learnings Applied
- **Sort order consistency** (`docs/solutions/logic-errors/inconsistent-task-sort-order-across-consumers.md`): Mobile must use `getAllTasks()` (manual order) like desktop, not `getSortedTasks()` (system sort).
- **Task teleportation** (`docs/solutions/ui-bugs/task-teleportation-on-status-change.md`): Status toggles must use optimistic local state, not full refresh. Re-sort only on background/resume.
- **Undo reorder index** (`docs/solutions/undo-system/undo-support-for-reorder-operations.md`): Drag-to-reorder must pass display index (position in `sort_order DESC` list), NOT raw `sortOrder` value.
- **Test isolation** (`docs/solutions/testing/test-isolation-prevention-strategies.md`): Mobile tests must use in-memory DBs, never touch device storage.

---

## Overview

Add an Android mobile app (`apps/mobile/`) to the cli-tasker monorepo, built with Expo (React Native) and sharing `@tasker/core` for full task management. Includes an Android home screen widget for quick task viewing and check-off. Phase 2 adds Turso embedded replicas for Mac-to-Android sync.

**Prerequisites:** Refactor `@tasker/core` to be driver-agnostic so it works with both `better-sqlite3` (Node.js) and `expo-sqlite` (React Native).

## Problem Statement

cli-tasker is currently Mac-only (CLI + menu bar tray app). There is no way to view or manage tasks from a phone. A mobile app with a home screen widget would make the task system accessible throughout the day without needing to be at the computer.

## Proposed Solution

A phased approach:

1. **Phase 0:** Refactor `@tasker/core` driver layer (prerequisite for mobile)
2. **Phase 1:** Local-only Expo Android app + home screen widget
3. **Phase 2:** Turso sync between Mac and Android (future, separate plan)

This plan covers Phase 0 and Phase 1. Phase 2 is deferred to a separate planning cycle.

## Technical Approach

### Architecture

```
packages/core/              shared core (driver-agnostic after Phase 0)
  src/
    db.ts                   portable: TaskerDb type, CREATE_SCHEMA_SQL, migrations
    db-node.ts              Node.js only: createDb(), createTestDb(), getDefaultDbPath()
    queries/                unchanged — accept TaskerDb, use Drizzle API
    parsers/                unchanged — pure functions
    schema/                 unchanged — drizzle-orm/sqlite-core (driver-agnostic)
    types/                  unchanged
    undo/                   unchanged (uses db.transaction() — cross-driver)
    backup/                 unchanged — Node.js only, not imported by mobile
    ai/                     unchanged — Node.js only, not imported by mobile

apps/cli/                   import createDb from '@tasker/core/db-node'
apps/desktop/               import createDb from '@tasker/core/db-node'
apps/mobile/                Expo app — creates its own Drizzle instance with expo-sqlite
  src/
    db.ts                   mobile DB factory using expo-sqlite + Drizzle
    app/                    Expo Router screens (file-based navigation)
    components/             React Native components
    hooks/                  useTaskStore, etc.
    lib/                    services, utils
    native/                 Kotlin bridge module (WidgetBridge)
  android-widget/           Kotlin Glance widget source + resources
  plugins/                  Expo config plugin (withTaskWidget.ts)
```

**Critical rule:** Mobile must NEVER import bare `@tasker/core` — the main entrypoint re-exports `BackupManager` and `ai/` which import `node:fs`. Mobile imports only from subpath exports: `@tasker/core/schema`, `@tasker/core/queries`, `@tasker/core/types`, `@tasker/core/parsers`, `@tasker/core/undo`.

### Core Refactor Strategy (Phase 0)

#### Key Finding: Drizzle Has Built-in Cross-Driver Raw SQL

Drizzle ORM provides `db.all(sql`...`)`, `db.run(sql`...`)`, `db.get(sql`...`)`, and `db.transaction()` directly on `BaseSQLiteDatabase`. These work identically across both `better-sqlite3` and `expo-sqlite` drivers. **No custom `RawDriver` interface is needed.**

This means the refactor is simpler than originally planned:

1. **Change `TaskerDb` type** to use `BaseSQLiteDatabase` from `drizzle-orm/sqlite-core`
2. **Replace `getRawDb()` calls** with Drizzle's cross-driver raw SQL methods
3. **Extract Node.js-specific code** to `db-node.ts`

#### Part 1: Extract DB Factory

Move `createDb()`, `createTestDb()`, `getDefaultDbPath()`, `getRawDb()`, `getDbPath()`, `withRetry()` from `db.ts` to `db-node.ts`. The main `db.ts` keeps only:
- `TaskerDb` type (driver-agnostic)
- `CREATE_SCHEMA_SQL` constant
- Migration helpers

```typescript
// packages/core/src/db.ts — after refactor
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema/index.js';

/** Driver-agnostic DB type. Both better-sqlite3 and expo-sqlite are 'sync'. */
export type TaskerDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export const CREATE_SCHEMA_SQL = `...`; // unchanged
```

```typescript
// packages/core/src/db-node.ts — Node.js specific (CLI + desktop)
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';
import type { TaskerDb } from './db.js';
// ... createDb(), createTestDb(), getDefaultDbPath(), getRawDb(), getDbPath(), withRetry()
```

#### Part 2: Replace getRawDb() with Drizzle Cross-Driver API

Replace all `getRawDb()` call sites in portable code with Drizzle's built-in methods:

| Pattern | Count | Replacement |
|---------|-------|-------------|
| `raw.transaction(() => {...})` | 8 | `db.transaction((tx) => {...})` |
| `WITH RECURSIVE` CTEs | 3 | `db.all(sql`WITH RECURSIVE ...`)` |
| `UNION` queries | 2 | `db.all(sql`... UNION ...`)` |
| `SELECT...GROUP BY` aggregation | 4 | `db.all(sql`SELECT ... GROUP BY ...`)` |
| `SELECT...WHERE id IN (?)` | 1 | `db.all(sql`SELECT ... WHERE id IN ...`)` |
| `pragma()` | 2 | Move to platform-specific `createDb()` |
| `ATTACH DATABASE` (backup) | 1 | Stays in `BackupManager` (Node-only, keeps `getRawDb()`) |

**Example transformation:**

```typescript
// BEFORE (task-queries.ts:865)
const raw = getRawDb(db);
const rows = raw.prepare(`
  WITH RECURSIVE desc AS (
    SELECT id FROM tasks WHERE parent_id = ? AND is_trashed = 0
    UNION ALL
    SELECT t.id FROM tasks t JOIN desc d ON t.parent_id = d.id WHERE t.is_trashed = 0
  )
  SELECT id FROM desc
`).all(parentId) as any[];

// AFTER
const rows = db.all<{ id: string }>(sql`
  WITH RECURSIVE desc AS (
    SELECT id FROM tasks WHERE parent_id = ${parentId} AND is_trashed = 0
    UNION ALL
    SELECT t.id FROM tasks t JOIN desc d ON t.parent_id = d.id WHERE t.is_trashed = 0
  )
  SELECT id FROM desc
`);
```

#### Sync vs Async API — RESOLVED

**Confirmed:** Both drivers produce `BaseSQLiteDatabase<'sync', ...>`. The `expo-sqlite` driver with `openDatabaseSync()` returns synchronous results, matching `better-sqlite3`. No async migration needed. The Drizzle source code confirms: `ExpoSQLiteDatabase<TSchema> extends BaseSQLiteDatabase<'sync', SQLiteRunResult, TSchema>`.

#### Files Changed in Core Refactor

| File | Change |
|------|--------|
| `src/db.ts` | Extract to `TaskerDb` type + `CREATE_SCHEMA_SQL` only. Remove Node.js imports. |
| `src/db-node.ts` | **New.** Move `createDb`, `createTestDb`, `getDefaultDbPath`, `getRawDb`, `getDbPath`, `withRetry`. |
| `src/index.ts` | Remove `BackupManager` and `ai` from main export. Add `@tasker/core/db-node` subpath. |
| `src/queries/task-queries.ts` | Replace ~15 `getRawDb()` calls with `db.all(sql`...`)` and `db.transaction()`. |
| `src/queries/list-queries.ts` | Replace 1 `getRawDb()` call with `db.transaction()`. |
| `src/undo/undo-manager.ts` | Replace 1 `getRawDb()` call with `db.transaction()`. |
| `src/backup/backup-manager.ts` | Keep `getRawDb()` — imports from `db-node.ts`. |
| `apps/cli/src/index.ts` | Import `createDb` from `@tasker/core/db-node`. |
| `apps/desktop/electron/*.ts` | Import `createDb` from `@tasker/core/db-node`. |
| `package.json` (core) | Add `"./db-node"` subpath export. |
| `tests/**` | Import `createTestDb` from `@tasker/core/db-node`. |

### Phase 1: Expo App

#### Project Setup

```bash
pnpm create expo-app --template default@sdk-55 apps/mobile
cd apps/mobile
npx expo install expo-sqlite
pnpm add drizzle-orm @tasker/core@workspace:* nativewind react-native-reanimated
pnpm add react-native-draggable-flatlist react-native-swipeable-item @gorhom/bottom-sheet
pnpm add @shopify/flash-list lucide-react-native
pnpm add -D drizzle-kit tailwindcss@^3.4.17
```

**Monorepo config changes:**
- Add `node-linker=hoisted` to `.npmrc` — **hard gate:** must verify CLI + desktop builds + all 308 tests pass before merging.
- `pnpm-workspace.yaml` already covers `apps/*`.
- Verify the `better-sqlite3` alias to `libsql` works under hoisted mode.

#### Mobile DB Initialization

```typescript
// apps/mobile/src/db.ts
import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from '@tasker/core/schema';
import { CREATE_SCHEMA_SQL, setRawDriver } from '@tasker/core';

const expoDb = openDatabaseSync('tasker.db', { enableChangeListener: true });
expoDb.execSync(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  ${CREATE_SCHEMA_SQL}
  INSERT OR IGNORE INTO lists (name, sort_order) VALUES ('tasks', 0);
`);

export const db = drizzle(expoDb, { schema });
```

#### Mobile Feature Scope (Phase 1)

| Feature | Phase | Notes |
|---------|-------|-------|
| View tasks by list | 1a | Uses `getAllTasks()` (manual sort order, like desktop) |
| Add task (with inline metadata) | 1a | Uses `@tasker/core` parsers |
| Edit task description | 1a | Bottom sheet editor (`@gorhom/bottom-sheet`) |
| Toggle status (all 4 states) | 1a | Optimistic local update, re-sort on background/resume |
| Delete task (soft delete) | 1a | Swipe-left action |
| View/restore trash | 1a | Trash tab |
| Search and filter | 1a | Uses `searchTasks()` from core |
| Create/rename/delete lists | 1a | |
| Switch between lists | 1a | Collapsible sections (like desktop) |
| Undo/redo | 1a | Independent stack per device |
| Hide completed per list | 1a | |
| Set priority | 1a | Via inline metadata |
| Set due date | 1a | Via inline metadata |
| Drag-to-reorder tasks | 1b | `react-native-draggable-flatlist` with `NestableDraggableFlatList` |
| Markdown rendering | 1b | |
| Home screen widget | 1c | Custom Kotlin Glance + Expo config plugin |
| Subtask management | Deferred | View only, create via metadata |
| Blocker/related management | Deferred | View badges only |
| AI decompose/summary | No | LM Studio not available on mobile |
| Backup/restore | No | Turso handles this in Phase 2 |

#### Navigation Structure (Expo Router)

```
apps/mobile/src/app/
  _layout.tsx              # Root Stack (wraps tabs + modals)
  (tabs)/
    _layout.tsx            # Tab navigator (3 tabs: Lists, Search, Trash)
    index.tsx              # Lists tab (default) — all lists with collapsible sections
    search.tsx             # Search tab
    trash.tsx              # Trash tab
  (modals)/
    edit-task.tsx           # Edit task bottom sheet
    move-to-list.tsx        # Move task picker
```

Deep linking from widget taps: `tasker:///(tabs)` opens lists, `tasker:///(modals)/edit-task?id=abc` opens edit.

#### Widget Architecture

**Framework:** Custom Kotlin Glance widget with Expo config plugin (NOT `android-glance-widget-expo` — it has 1 star and is experimental).

**Data flow:**
1. React Native app writes tasks to SQLite via `@tasker/core` queries
2. `expo-sqlite`'s `enableChangeListener` detects DB writes automatically
3. Change listener debounces (500ms) and serializes top 10 pending tasks to `SharedPreferences` (`MODE_PRIVATE`) via `WidgetBridge` native module
4. Calls `TaskListWidget().updateAll(context)` to trigger Glance recomposition
5. Widget reads `SharedPreferences` in `provideGlance()` and renders `LazyColumn`

**Widget check-off flow:**
1. User taps checkbox → Glance `ActionCallback` fires
2. `ToggleTaskAction.onAction()` toggles status in SharedPreferences and writes to `pending_actions` queue
3. Widget self-updates immediately via `widget.update(context, glanceId)`
4. On app resume (`AppState` listener), RN reads `pending_actions`, applies to SQLite via core, clears queue, re-syncs widget

**Widget check-offs are NOT undoable** — acceptable tradeoff for simplicity.

**Security:**
- SharedPreferences uses `MODE_PRIVATE` (default, app-only access)
- Widget PendingIntents use explicit Intents with `FLAG_IMMUTABLE`
- Serialize only display-only fields (task ID, truncated title, status, priority) — never full descriptions

**Widget display:** Shows tasks from default list (user-configurable via widget config). Max 10 items. Uses `SizeMode.Responsive` with 3 breakpoints. `GlanceTheme` for automatic dark mode. `itemId` for stable scroll position.

#### Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `expo-sqlite` | SDK 55 bundled | SQLite driver |
| `drizzle-orm` | ^0.38.4 | ORM (shared with core) |
| `expo-router` | v7 (SDK 55) | File-based navigation |
| `nativewind` | ^4.2.0 | Tailwind CSS for React Native |
| `tailwindcss` | ^3.4.17 | Tailwind engine (NativeWind v4 requires v3, not v4) |
| `@shopify/flash-list` | latest | RecyclerView-like virtualized list (100+ items) |
| `react-native-draggable-flatlist` | ^4.0.3 | Drag-to-reorder with Reanimated |
| `react-native-swipeable-item` | ^2.0.0 | Swipe actions (complete, delete) |
| `@gorhom/bottom-sheet` | ^5 | Task edit bottom sheet |
| `lucide-react-native` | latest | Icons (consistent with desktop) |
| `react-native-reanimated` | SDK 55 bundled | Animations |
| `react-native-gesture-handler` | SDK 55 bundled | Touch handling |

#### UX Patterns

- **Swipe right:** Mark complete (green reveal, checkmark icon)
- **Swipe left:** Delete (red reveal, trash icon)
- **Long press:** Enter drag-to-reorder mode
- **Tap task:** Open bottom sheet editor
- **FAB (bottom-right):** Add new task
- **Pull-to-refresh:** Re-read from SQLite
- **Status toggle:** Tap checkbox cycles Pending → Done, Done/WontDo → Pending. Right-click equivalent: long-press → context menu with all 4 states.

#### Performance Considerations

- **Use FlashList** over FlatList/SectionList — RecyclerView-like recycling, 2-5x better for variable-height task items
- **Optimistic status updates** — dispatch local state change immediately, don't await DB or re-sort. Re-sort on background/resume (mirrors desktop pattern).
- **Debounce widget sync** — 500ms trailing debounce with `SharedPreferences.apply()` (async write, not `commit()`)
- **Consolidate schema init** — single `execSync` call for all PRAGMAs + schema + default list
- **Batch list metadata query** — create `getListsWithMetadata(db)` in core: `SELECT name, is_collapsed, hide_completed, sort_order FROM lists ORDER BY sort_order`. Collapses N+1 into 1.
- **Wrap `setStatus()` cascade in transaction** — currently unprotected, add `db.transaction()` around descendant updates
- **`React.memo` all task row components** with stable keys

## Implementation Phases

### Phase 0: Core Refactor (prerequisite)

1. **Change `TaskerDb` type** to `BaseSQLiteDatabase<'sync', unknown, typeof schema>`
2. **Create `db-node.ts`** — move Node.js-specific code from `db.ts`
3. **Replace `getRawDb()` calls** with Drizzle cross-driver methods (`db.all(sql`...`)`, `db.transaction()`)
4. **Remove `BackupManager`/`ai` from main `index.ts`** re-export (keep as subpath exports only)
5. **Add `./db-node` subpath export** to core `package.json`
6. **Update imports** in CLI, desktop, and tests
7. **Add `getListsWithMetadata()`** batch query to core
8. **Run all existing tests** — 222 core unit + 86 desktop E2E must pass
9. **Test `node-linker=hoisted`** — hard gate, full build + test pass for all packages

**Success criteria:** All 308 tests pass, desktop and CLI work unchanged, core can be imported by a React Native project without Node.js errors.

### Phase 1a: Expo App Shell

1. **Create `apps/mobile/`** with Expo SDK 55
2. **Configure monorepo** — `.npmrc` (`node-linker=hoisted`), Metro config, workspace dep
3. **Mobile DB initialization** — `expo-sqlite` + Drizzle + schema bootstrap
4. **Basic navigation** — Expo Router tabs (Lists, Search, Trash)
5. **Task list view** — FlashList with collapsible list sections, render from `getAllTasks()`
6. **Add task** — FAB + text input with inline metadata parsing
7. **Edit task** — bottom sheet with `@gorhom/bottom-sheet`
8. **Toggle status** — optimistic local update, re-sort on resume
9. **Delete task** — swipe-left to soft delete
10. **Undo/redo** — `UndoManager` works directly with mobile's Drizzle `db`
11. **Search** — search bar with filter syntax
12. **List management** — create, rename, delete, hide completed

### Phase 1b: Full Features

1. **Drag-to-reorder** — `NestableDraggableFlatList` for per-section drag
2. **Markdown rendering** — basic markdown in task descriptions
3. **Priority/due date pickers** — dedicated UI beyond inline metadata

### Phase 1c: Widget

1. **Write Expo config plugin** (`plugins/withTaskWidget.ts`) — injects Glance deps, Kotlin files, manifest receiver
2. **Write Kotlin Glance widget** — `TaskListWidget` with `LazyColumn`, `TaskRow`, `ToggleTaskAction`
3. **Write `WidgetBridge` native module** — `setJsonData()`, `requestWidgetUpdate()`, `getData()`
4. **Wire change listener** — `expo-sqlite` change listener → debounced sync to SharedPreferences
5. **Pending actions queue** — widget writes toggles to `pending_actions` in SharedPreferences, app processes on resume
6. **Widget configuration** — select which list to display

## Acceptance Criteria

### Functional Requirements

- [ ] Mobile app launches on Android, shows tasks from local SQLite
- [ ] Add/edit/delete tasks with full inline metadata support
- [ ] All 4 statuses work: Pending, InProgress, Done, WontDo
- [ ] Search with filter syntax matches desktop behavior
- [ ] List management: create, rename, delete, switch, collapse, hide completed
- [ ] Drag-to-reorder persists sort order (Phase 1b)
- [ ] Undo/redo works for all operations
- [ ] Trash: view, restore, empty
- [ ] Home screen widget shows tasks from selected list (Phase 1c)
- [ ] Widget check-off updates task status (Phase 1c)
- [ ] Core refactor does not break existing CLI or desktop (222 unit + 86 E2E tests pass)

### Non-Functional Requirements

- [ ] App cold start < 2 seconds
- [ ] Task list renders 100+ tasks without jank (FlashList)
- [ ] Widget updates within 1 second of app mutation (debounced)
- [ ] Offline-first: works with no network at all

### Quality Gates

- [ ] Core unit tests pass (222 tests)
- [ ] Desktop E2E tests pass (86 tests)
- [ ] Mobile unit tests for DB initialization, query integration
- [ ] Manual test on physical Android device
- [ ] `node-linker=hoisted` verified against all existing builds

## Dependencies & Prerequisites

- Expo SDK 55+ (React Native 0.83, New Architecture mandatory)
- Android SDK 24+ (minSdkVersion, for Jetpack Glance)
- pnpm `node-linker=hoisted` — hard gate with full test pass
- Metro supports `package.json` `"exports"` by default since SDK 53
- NativeWind v4.2.0+ (compatible with Reanimated v4 and New Architecture)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ~~expo-sqlite Drizzle driver is async-only~~ | ~~Medium~~ | ~~High~~ | **RESOLVED:** Both drivers are `'sync'`. Confirmed from Drizzle source. |
| `node-linker=hoisted` breaks existing builds | Low | Medium | Hard gate: test in isolated branch. Verify `libsql` alias works. Fallback: Metro `unstable_enableSymlinks`. |
| Widget data sync is unreliable | Medium | Medium | Debounced SharedPreferences + change listener. Pending actions queue for check-offs. |
| `android-glance-widget-expo` is too immature | ~~Medium~~ | ~~Low~~ | **RESOLVED:** Not using it. Custom Kotlin Glance + Expo config plugin instead. |
| Core refactor introduces regressions | Low | High | 308 existing tests (222 unit + 86 E2E). Run after every change. |
| NativeWind v4 hot reload style loss | Medium | Low | Known issue. Clear Metro cache with `npx expo start -c`. Not a production concern. |

## Security Considerations

- **SQLite unencrypted** — acceptable for personal task manager. Android internal storage is sandboxed per-app. Document as deliberate decision.
- **SharedPreferences** — `MODE_PRIVATE` only. Serialize display-only fields (ID, truncated title, status, priority). Never full descriptions.
- **Widget PendingIntents** — explicit Intents with `FLAG_IMMUTABLE`. Glance's `actionRunCallback` handles this by default.
- **Phase 2 Turso tokens** — must use `expo-secure-store` (Android Keystore). Never SharedPreferences or AsyncStorage. Add as Phase 2 security requirement.
- **RawDriver SQL injection** — Drizzle's `sql` template tag handles parameterization. `db.all(sql`...${param}...`)` is safe. Only `exec()` (used for DDL) takes raw strings — restricted to schema initialization.

## Future Considerations (Phase 2)

- **Turso sync** — OP-SQLite + libSQL driver for embedded replicas. `undo_history` table excluded from sync. `updated_at` column for LWW. Desktop/CLI migration strategy TBD (separate plan).
- **iOS support** — Expo is cross-platform. Add iOS target later.
- **Push notifications** — due date reminders via Expo Notifications.
- **FTS5** — add full-text search if `searchTasks()` LIKE becomes slow at 500+ tasks.

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-03-17-mobile-app-android-brainstorm.md`
- Core DB layer: `packages/core/src/db.ts`
- Core queries: `packages/core/src/queries/task-queries.ts`
- Desktop IPC pattern: `apps/desktop/electron/ipc/tasks/`
- Sort order learning: `docs/solutions/logic-errors/inconsistent-task-sort-order-across-consumers.md`
- Task teleportation learning: `docs/solutions/ui-bugs/task-teleportation-on-status-change.md`
- Undo reorder learning: `docs/solutions/undo-system/undo-support-for-reorder-operations.md`
- Test isolation learning: `docs/solutions/testing/test-isolation-prevention-strategies.md`

### External References
- [Drizzle ORM + expo-sqlite](https://orm.drizzle.team/docs/connect-expo-sqlite)
- [Drizzle ORM raw SQL (sql operator)](https://orm.drizzle.team/docs/sql)
- [Expo Monorepo Guide](https://docs.expo.dev/guides/monorepos/)
- [Expo SQLite Docs](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo Router Navigation Patterns](https://docs.expo.dev/router/basics/common-navigation-patterns)
- [Metro Package Exports Support](https://metrobundler.dev/docs/package-exports/)
- [NativeWind v4 Installation](https://www.nativewind.dev/docs/getting-started/installation)
- [react-native-draggable-flatlist](https://github.com/computerjazz/react-native-draggable-flatlist)
- [@shopify/flash-list](https://shopify.github.io/flash-list/)
- [Jetpack Glance Widget Development](https://developer.android.com/develop/ui/compose/glance)
- [OP-SQLite + Turso Example](https://github.com/theorib/op-sqlite-turso-expo-react-native)
- [Turso Embedded Replicas](https://docs.turso.tech/features/embedded-replicas/introduction)
