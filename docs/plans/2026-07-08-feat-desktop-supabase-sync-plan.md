# Plan: Desktop ⇄ Cloud sync via a direct Supabase bridge

## Context

The mobile app now syncs live through PowerSync + Supabase (verified this session). The **desktop app is an isolated island**: it reads/writes only its local `tasker.db` (better-sqlite3 via `@tasker/core`) and has no cloud connection — so a task created on desktop never reaches mobile, and vice-versa. The one-time reseed we did today made mobile *match* desktop once; nothing keeps them in sync going forward.

The historical attempt (`apps/desktop/electron/sync/*`) tried to run `@powersync/node` inside Electron and crashed with SIGABRT (Rust SQLite extension + asar packaging) — that blocker has stalled this for months.

**Chosen approach (user-selected): a direct Supabase sync bridge, no PowerSync on desktop.** Supabase Postgres is already the shared hub (mobile syncs to it via PowerSync). The desktop just needs to keep its local `tasker.db` in two-way sync with Supabase using pure-JS `@supabase/supabase-js` + Supabase Realtime. This:
- **Sidesteps the `@powersync/node` Electron crash entirely** (no native modules).
- **Requires no async refactor** — `tasker.db` stays the desktop's DB, all ~100 synchronous `@tasker/core` query call-sites and the undo/backup systems are untouched.
- **Keeps the CLI working** — CLI and desktop keep sharing `tasker.db`; CLI writes even sync too (see below).

Trade-off accepted: we hand-roll sync correctness. Scope is bounded — a single user, 4 tables, soft-delete model — mitigated with Realtime + last-write-wins + a change-outbox + a loop guard.

## Architecture

```
            ┌─────────────── Electron main process ───────────────┐
 tasker.db  │  core sync queries (unchanged)   supabase-sync.ts    │      Supabase Postgres
 (better-   │        │                              │  ▲           │      (shared hub)
  sqlite3)  │        ▼ writes                       │  │           │
   ▲────────┼── sync_outbox (triggers) ──drain────► push (upsert/  ├────►  tasks / lists /
   │        │                                       │   delete)    │       task_dependencies /
   └────────┼◄── apply remote (applying_remote=1) ◄─┘  Realtime ◄──┼────── task_relations
            │        │                                  (pull)      │            ▲
            │        ▼ broadcast 'db:changed'                       │            │ PowerSync
            └──────────────────────────────────────────────────────┘       Mobile app
```

Data flow:
- **Push (local → cloud):** every write to `tasker.db` (from desktop IPC handlers *or* the CLI) fires a trigger that appends to a local-only `sync_outbox` table. The sync module drains the outbox and upserts/deletes the affected rows in Supabase.
- **Pull (cloud → local):** a Supabase Realtime `postgres_changes` subscription on the 4 tables applies remote INSERT/UPDATE/DELETE to `tasker.db`, then broadcasts `db:changed` so the renderer refreshes (existing mechanism).
- **Loop guard:** while applying remote changes, a `sync_state.applying_remote` flag is set to 1; the outbox triggers skip enqueuing, so pulled changes are not re-pushed.
- **Conflict:** last-write-wins by `updated_at` (single-user; concurrent edits to the same row are rare).

## Schema changes

### Core (`packages/core`) — add `updated_at`
- `packages/core/src/db.ts` (`CREATE_SCHEMA_SQL`): add `updated_at TEXT` to the `tasks` and `lists` table definitions. (`task_dependencies`/`task_relations` are insert/delete-only — no `updated_at` needed.)
- `packages/core/src/db-node.ts` (`createDb`): add defensive idempotent migrations next to the existing `hide_completed` one:
  ```
  try { sqlite.exec(`ALTER TABLE tasks ADD COLUMN updated_at TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE lists ADD COLUMN updated_at TEXT`); } catch {}
  ```
- Also mirror into `packages/core/src/schema/tasks.ts` + `lists.ts` (Drizzle) so the type carries the column. It stays nullable and is maintained by the sync layer, so the CLI and existing queries need no changes.

### Sync-local objects — created by the desktop sync module (idempotent, NOT in core)
Created via `getRawDb(db).exec(...)` on sync init so they live in `tasker.db` and persist (so CLI writes get captured even when desktop later runs):
- `sync_state (applying_remote INTEGER NOT NULL DEFAULT 0)` — single row.
- `sync_outbox (seq INTEGER PK AUTOINCREMENT, tbl TEXT, pk TEXT, op TEXT, ts TEXT)`.
- `AFTER INSERT/UPDATE/DELETE` triggers on `tasks`, `lists`, `task_dependencies`, `task_relations`, each guarded by `WHEN (SELECT applying_remote FROM sync_state) = 0`, inserting a row into `sync_outbox` with `ts = strftime('%Y-%m-%dT%H:%M:%fZ','now')` and the natural PK (task id; list name; composite `a||'.'||b` for junctions, matching mobile's `toSupabaseRow`). SQLite's default `recursive_triggers = OFF` avoids re-entrancy.

## New files (`apps/desktop/electron/sync/`)

Replace the dead PowerSync scaffolding with:
- **`supabase-sync.ts`** — the module. Exports `startSupabaseSync(db, getWindow)` and `stopSupabaseSync()`.
  - `createClient(url, publishableKey)` then `signInAnonymously()` (reuse mobile's auth pattern from `apps/mobile/src/supabase-connector.ts`).
  - `initSyncObjects(db)` — create `sync_state`/`sync_outbox`/triggers (idempotent).
  - `reconcile(db)` — startup convergence: fetch all remote rows per table, LWW-upsert into `tasker.db` (newer/missing only), then drain the outbox to push local changes. **No bulk deletes** in reconcile (safety); deletes propagate incrementally only.
  - `drainOutbox(db)` — read `sync_outbox` ordered by `seq`; for PUT/PATCH read the current row and `upsert` to Supabase with `updated_at = ts`; for DELETE, `.delete().eq(pk)`; delete drained rows. Wrap Supabase calls; swallow fatal Postgres codes (22*/23*) like mobile does; keep the outbox row on transient failure for retry.
  - `subscribeRealtime(db, getWindow)` — `.channel().on('postgres_changes', {event:'*', schema:'public', table})` for each table. On event: set `applying_remote=1`, apply INSERT/UPDATE (LWW: skip if a pending outbox entry for that pk has `ts >= new.updated_at`) or DELETE to `tasker.db` via raw SQL, reset flag, `getWindow().webContents.send('db:changed')`.
  - Reconnect handling: on Realtime `SUBSCRIBED` (re)connect, re-run `reconcile()` to catch events missed while offline. Backstop: a periodic `drainOutbox` timer (e.g. 15s) in case a local write wasn't observed.
  - `TASKER_TEST_MODE === '1'` → `startSupabaseSync` returns immediately (no network) so E2E never touches real Supabase.
- **`row-mapping.ts`** — per-table map between a `tasker.db` row and a Supabase row: `tasks` id direct; `lists` → only `{name, sort_order, updated_at}` (leave `is_collapsed`/`hide_completed` **local/unsynced** — per-device UI prefs, matching mobile); junctions → composite id split/join. Port from `apps/mobile/src/supabase-connector.ts:toSupabaseRow`.
- **`config.ts`** — `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` from `process.env` (loaded from `apps/desktop/.env` via `dotenv` in dev; both values are non-secret — publishable key ships in clients).

### Delete (dead, stale, PowerSync-based)
- `apps/desktop/electron/sync/supabase-bridge.ts` (hardcoded OLD creds, `@powersync/node` merge-bridge)
- `apps/desktop/electron/sync/powersync-worker.ts`
- `apps/desktop/scripts/build-powersync-worker.mjs` (+ the empty `scripts/` dir)

## Files to modify
- **`apps/desktop/electron/main.ts`** — after `createDb`/`UndoManager` (~line 84), call `startSupabaseSync(db, getPopupWindow)`; call `stopSupabaseSync()` in the `before-quit` handler next to `stopDbWatcher()` (~line 121). Load `dotenv` at top for dev. Skip when `TASKER_TEST_MODE==='1'`.
- **`apps/desktop/package.json`** — add deps `@supabase/supabase-js` and `dotenv`. (No native modules → no electron-builder/asar changes.)
- **`apps/desktop/vite.config.ts`** — add `@supabase/supabase-js` to the main-process rollup `external` array (alongside `better-sqlite3`, `eventkit-node`).
- **`apps/desktop/.gitignore` + new `apps/desktop/.env.example`** — ignore `.env`, document the two vars (mirror mobile's).
- **`apps/desktop/electron/lib/watcher.ts`** — optional: also trigger an outbox drain on `change` (fast local-change push) in addition to `db:changed`. The 15s backstop timer covers it otherwise.

## Supabase-side prep (via the Supabase MCP `apply_migration` / `execute_sql`)
- Add `updated_at TEXT`/`timestamptz` to `lists` (tasks already has it); default optional.
- **Enable Realtime**: `ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks, public.lists, public.task_dependencies, public.task_relations;` (`REPLICA IDENTITY FULL` is already set from the PowerSync setup, so DELETE events carry the PK). Confirm RLS `authenticated`-all policies allow the anon session to receive Realtime (they do).
- Note: this does **not** disturb mobile — PowerSync uses the separate `powersync` publication + logical replication; Realtime uses `supabase_realtime`.

## Risks & mitigations
- **Sync loop** → `applying_remote` flag gates the outbox triggers; pulled writes never re-enqueue.
- **Deletes** → local deletes captured by the DELETE trigger → outbox → Supabase; remote deletes via Realtime DELETE (+ `REPLICA IDENTITY FULL`). Reconcile deliberately avoids bulk deletes.
- **Missed events while offline** → outbox persists local (and CLI) changes; `reconcile()` on every (re)subscribe pulls remote state.
- **Concurrent same-row edit** → LWW by `updated_at`; acceptable for single-user.
- **CLI writes while desktop is closed** → queued in `sync_outbox` (triggers persist in the DB file), pushed on next desktop launch.
- **Realtime auth/RLS** → anon session + existing `authenticated` policies; verify a Realtime event is actually received during implementation before building on it.

## Verification
1. **Existing E2E must stay green**: `pnpm --filter @tasker/desktop run build && pnpm test:e2e` — sync no-ops under `TASKER_TEST_MODE=1`, so the 31 tests are unaffected.
2. **Push path**: run desktop (`pnpm dev:desktop`), add/rename/complete/delete a task → verify via Supabase MCP `execute_sql` (`SELECT ... FROM tasks WHERE ...`) that the row/updated_at/deletion landed.
3. **Pull path**: `execute_sql` an INSERT/UPDATE/DELETE directly in Supabase (or edit on mobile) → verify it appears in the desktop UI within a second (Realtime) and in `tasker.db`.
4. **CLI push**: with desktop running, `tasker add "..."` → confirm it reaches Supabase.
5. **End-to-end**: create on desktop → appears on mobile; create on mobile → appears on desktop.
6. **Loop check**: confirm a pulled change does not bounce back (watch `sync_outbox` stays empty after a remote apply).
7. Write an integration script under `apps/desktop/scripts/` (like this session's `reseed.mjs`) that drives push+pull against Supabase for a repeatable smoke test.

## Suggested phasing
1. **Schema + Supabase prep** — `updated_at`, Realtime publication. (verify Realtime delivers an event)
2. **Push** — sync objects/triggers, `drainOutbox`, auth/config, wire into `main.ts`; verify desktop→Supabase.
3. **Pull** — Realtime subscribe + apply + loop guard; verify Supabase→desktop and end-to-end with mobile.
4. **Robustness** — startup + on-reconnect `reconcile`, offline outbox, test-mode no-op, delete edge cases.
5. **Cleanup + tests** — delete dead PowerSync files, add the integration smoke script, confirm E2E green. Save this plan to `docs/plans/2026-07-08-feat-desktop-supabase-sync-plan.md` and update `docs/reference` + `CLAUDE.md` if architecture notes change.
