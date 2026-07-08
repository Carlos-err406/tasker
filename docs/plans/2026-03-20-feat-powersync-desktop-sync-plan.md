# Plan: Fix PowerSync Node in Electron (Vite)

## Context

Desktop ↔ mobile sync is blocked because `@powersync/node` crashes in Electron. The Rust SQLite extension panics and the worker has ESM/CJS issues. Mobile sync via PowerSync + Supabase already works. We need the desktop to also use PowerSync for automatic two-way sync.

## Phase 0: Make PowerSync Load in Electron (~1 day)

### 0.1 Fix the custom worker build — BUNDLE instead of externalize

The root cause: esbuild externalizes `@powersync/node`, so the worker tries to `require()` it at runtime, hitting ESM/CJS issues and the `node:sqlite` import.

**Fix:** Bundle `@powersync/node/worker.js` INTO the worker output. Alias `node:sqlite` to an empty module.

**File:** `apps/desktop/scripts/build-powersync-worker.mjs`
```js
await build({
  entryPoints: ['electron/sync/powersync-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-electron/powersync-worker.cjs',
  external: ['better-sqlite3'],  // ONLY native module
  alias: { 'node:sqlite': './electron/sync/empty-sqlite.ts' },
});
```

**New file:** `apps/desktop/electron/sync/empty-sqlite.ts`
```ts
export const DatabaseSync = undefined;
```

### 0.2 Configure asarUnpack for native extensions

**File:** `apps/desktop/electron-builder.json5`
```json5
"asarUnpack": [
  "**/powersync-worker.cjs",
  "**/powersync/**",
  "**/better-sqlite3/**",
  "**/*.node"
]
```

### 0.3 Add vite externals

**File:** `apps/desktop/vite.config.ts` — main process externals:
```ts
external: ['better-sqlite3', 'eventkit-node', /\.node$/, '@powersync/node', '@powersync/common', 'comlink', /^@supabase\//]
```

### 0.4 Wire build chain

**File:** `apps/desktop/package.json`
```json
"build": "vite build && node scripts/build-powersync-worker.mjs"
```

### 0.5 Test — app should start without SIGABRT

## Phase 1: Desktop Uses PowerSync as Single DB (~2-3 days)

Same architecture as mobile — PowerSync owns the SQLite, all queries are async raw SQL.

### 1.1 Desktop PowerSync DB module

**New file:** `apps/desktop/electron/sync/powersync-db.ts`
- Creates `PowerSyncDatabase` with custom `openWorker`
- Creates local-only tables (`config`, `undo_history`) after init
- Connects to Supabase via `SupabaseConnector`
- Exports `psDb`, `initSync()`

### 1.2 Async query layer

**New file:** `apps/desktop/electron/sync/async-queries.ts`
- Port mobile's `dbGetAllTasks`, `dbAddTask`, `dbSetStatus`, etc.
- Same raw SQL, same `rowToTask` mapper
- Used by IPC handlers

### 1.3 Make IPC handlers async

**File:** `apps/desktop/electron/ipc/tasks/main.ts` (+ lists, undo handlers)
- Replace sync `@tasker/core` query calls with async PowerSync queries
- `$try` wrapper must handle async functions

### 1.4 Update main.ts initialization

**File:** `apps/desktop/electron/main.ts`
- Replace `createDb(dbPath)` with `initPowerSyncDb()`
- Start sync after init
- Pass `psDb` to IPC handlers

### 1.5 Undo/redo via local-only tables

- `undo_history` table created via raw SQL (not in PowerSync schema, not synced)
- New `AsyncUndoManager` using `psDb.execute()`

## Phase 2: Dependency Isolation (~half day)

### 2.1 Desktop-only deps
- `@powersync/node` in `apps/desktop/package.json` only
- Mobile uses `@powersync/react-native` only

### 2.2 Build isolation
- `pnpm deploy` or explicit `electron-builder` file filters
- Pre-package check script

## Phase 3: Tests (~1 day)

### 3.1 E2E fixtures
- Point PowerSync to temp dir
- Skip `connect()` in tests (offline mode)
- Update `tasker:resetForTest` IPC

### 3.2 Verify all 31 E2E tests pass

## Critical Files

| File | Change |
|------|--------|
| `apps/desktop/scripts/build-powersync-worker.mjs` | Bundle @powersync/node, alias node:sqlite |
| `apps/desktop/electron/sync/empty-sqlite.ts` | New — empty node:sqlite shim |
| `apps/desktop/electron/sync/powersync-worker.ts` | Exists — custom worker |
| `apps/desktop/electron/sync/powersync-db.ts` | New — PowerSync init + connect |
| `apps/desktop/electron/sync/async-queries.ts` | New — async query layer |
| `apps/desktop/electron/sync/supabase-bridge.ts` | Refactor → connector only |
| `apps/desktop/electron/ipc/tasks/main.ts` | Async IPC handlers |
| `apps/desktop/electron/main.ts` | PowerSync init instead of createDb |
| `apps/desktop/vite.config.ts` | Add externals |
| `apps/desktop/electron-builder.json5` | Add asarUnpack |
| `apps/desktop/package.json` | Build script, deps |

## Verification

1. `pnpm --filter @tasker/desktop run build` — no errors
2. `node scripts/build-powersync-worker.mjs` — worker + dylib copied
3. `./install.sh` — app installs
4. Open app — no crash, tray icon appears, tasks load
5. Check a task on desktop → appears on mobile (via PowerSync → Supabase)
6. Check a task on mobile → appears on desktop within 30s
7. `pnpm test:e2e` — all 31 tests pass
