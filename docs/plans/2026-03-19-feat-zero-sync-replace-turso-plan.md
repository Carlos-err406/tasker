---
title: "feat: Replace Turso sync with Zero for real-time sync"
type: feat
status: active
date: 2026-03-19
deepened: 2026-03-19
---

# Replace Turso Sync with Zero

## Enhancement Summary

**Deepened on:** 2026-03-19
**Research agents:** Zero deployment (Fly.io/Neon), Zero offline patterns (RN), Zero schema/permissions/mutations API, Desktop-Postgres bridge patterns

### Key Improvements
1. **Neon billing trap identified** — zero-cache's persistent connection prevents Neon auto-suspend, exhausting free tier in ~1 week. Alternatives evaluated.
2. **Offline UX fully designed** — connection state gating, 60s write grace period, `useConnectionState()` hook patterns
3. **Desktop bridge library chosen** — `@neondatabase/serverless` + Drizzle over HTTP (not TCP), with SQLite triggers for `updated_at`
4. **Permissions corrected** — must use `ANYONE_CAN_DO_ANYTHING` (empty arrays = deny by default)
5. **Zero client setup corrected** — uses `ZeroProvider` + `expoSQLiteStoreProvider()`, not direct constructor

### Critical Findings
- Zero does NOT enforce FK constraints client-side — relationships are query-only, Postgres enforces integrity
- Zero writes are queued for 60s during `connecting` state, then rejected — not immediately
- `ZERO_UPSTREAM_DB` must be a **direct** Neon connection (no pgbouncer pooling)
- Schema changes: update Postgres first, then app code, or clients enter reload loop

---

## Overview

Replace the hand-rolled Turso HTTP sync in the mobile app with [Zero](https://zero.rocicorp.dev) (by Rocicorp) — a query-driven sync engine that replicates Postgres into local SQLite on clients. Zero provides real-time background sync, offline reads, and server-reconciled conflict resolution.

**Why:** The current Turso sync has fundamental issues — race conditions between push/pull, data loss on pull-to-refresh, no real-time updates, and a naive destructive-replace strategy. Zero solves all of these by design.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│ Desktop/CLI │     │  zero-cache   │     │  Mobile   │
│ (SQLite)    │────▶│  (Fly.io)    │◀───▶│ (Zero +   │
│             │push │              │sync │  SQLite)  │
└─────────────┘     └──────┬───────┘     └───────────┘
                           │
                    ┌──────▼───────┐
                    │   Postgres   │
                    │  (Neon/Fly)  │
                    └──────────────┘
```

- **Postgres** — upstream source of truth (Neon or Fly Postgres)
- **zero-cache** (Fly.io ~$3-5/mo) — replication engine between Postgres and clients
- **Zero client** (mobile) — syncs Postgres subset into local SQLite, reads/writes are local
- **Desktop bridge** — pushes local SQLite changes to Postgres via `@neondatabase/serverless`

## Infrastructure Decision: Postgres Provider

> **Research finding:** Zero-cache keeps a persistent replication connection to Postgres. This prevents Neon from auto-suspending, exhausting the free tier (~191 compute hours) in about 1 week.

| Provider | Cost | Pros | Cons |
|----------|------|------|------|
| **Neon free** | $0 (broken) | Serverless, easy setup | zero-cache prevents auto-suspend → exhausts free tier in ~7 days |
| **Neon Launch** | $19/mo | Same as above, more hours | Expensive for personal project |
| **Fly Postgres** | ~$3-7/mo | Same network as zero-cache, always-on by design | More ops (but Fly manages it) |
| **Supabase free** | $0 | Always-on Postgres, no suspend penalty | 500MB limit, more features than needed |

**Recommendation:** Fly Postgres (co-located with zero-cache) or Supabase free tier. Avoid Neon free tier.

### zero-cache Connection Requirements

- `ZERO_UPSTREAM_DB` — **must be direct connection** (no pgbouncer). Neon pooler URLs won't work.
- `ZERO_CVR_DB` and `ZERO_CHANGE_DB` — can use pooled connections. Can point to same DB as upstream for a single-user app.
- Reduce connection limits for small providers: `ZERO_UPSTREAM_MAX_CONNS=4`, `ZERO_CVR_MAX_CONNS=10`, `ZERO_CHANGE_MAX_CONNS=1`

## Proposed Solution

### Phase 1: Postgres Schema + Zero Infrastructure

1. **Create Postgres schema**, mirroring the 4 synced tables:

```sql
CREATE TABLE lists (
  name TEXT PRIMARY KEY,
  sort_order INTEGER DEFAULT 0
);
-- Note: is_collapsed, hide_completed are LOCAL-ONLY (not in Postgres)

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  status INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  list_name TEXT NOT NULL REFERENCES lists(name) ON DELETE CASCADE ON UPDATE CASCADE,
  due_date TEXT,
  priority INTEGER,
  tags TEXT,
  is_trashed INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  completed_at TEXT,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on every change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocks_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocks_task_id),
  CHECK (task_id != blocks_task_id)
);

CREATE TABLE task_relations (
  task_id_1 TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_id_2 TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id_1, task_id_2),
  CHECK (task_id_1 < task_id_2)
);

-- Enable logical replication (required for zero-cache)
-- In Neon: Settings -> Logical Replication -> Enable
-- In Fly/Supabase: ALTER SYSTEM SET wal_level = logical;
```

2. **Seed Postgres** with existing desktop data (one-time migration script using `better-sqlite3` → `pg`).

3. **Deploy zero-cache** to Fly.io:

```toml
# fly.toml
app = "tasker-zero-cache"
primary_region = "iad"  # same region as Postgres

[build]
image = "registry.hub.docker.com/rocicorp/zero:latest"

[http_service]
internal_port = 4848
force_https = true
auto_stop_machines = "off"   # CRITICAL: zero-cache must run 24/7
min_machines_running = 1

[[http_service.checks]]
grace_period = "10s"
interval = "30s"
method = "GET"
timeout = "5s"
path = "/"

[[vm]]
memory = "512mb"
cpu_kind = "shared"
cpus = 1

[mounts]
source = "sqlite_db"
destination = "/data"

[env]
ZERO_REPLICA_FILE = "/data/sync-replica.db"
ZERO_LOG_LEVEL = "info"
ZERO_UPSTREAM_MAX_CONNS = "4"
ZERO_CVR_MAX_CONNS = "10"
ZERO_CHANGE_MAX_CONNS = "1"
```

```bash
# Set secrets (never in fly.toml)
fly secrets set \
  ZERO_UPSTREAM_DB="postgres://..." \
  ZERO_CVR_DB="postgres://..." \
  ZERO_CHANGE_DB="postgres://..." \
  ZERO_ADMIN_PASSWORD="..." \
  --app tasker-zero-cache
```

### Phase 2: Zero Client in Mobile App

1. **Define Zero schema** in `apps/mobile/src/zero-schema.ts`:

```typescript
import {
  table, string, number, createSchema,
  definePermissions, ANYONE_CAN_DO_ANYTHING,
  relationships,
} from '@rocicorp/zero';

const task = table('tasks')
  .columns({
    id: string(),
    description: string(),
    status: number(),
    created_at: string(),
    list_name: string(),
    due_date: string().optional(),
    priority: number().optional(),
    tags: string().optional(),
    is_trashed: number(),
    sort_order: number(),
    completed_at: string().optional(),
    parent_id: string().optional(),
    updated_at: string().optional(),
  })
  .primaryKey('id');

const list = table('lists')
  .columns({
    name: string(),
    sort_order: number(),
  })
  .primaryKey('name');

const taskDependency = table('task_dependencies')
  .columns({
    task_id: string(),
    blocks_task_id: string(),
  })
  .primaryKey('task_id', 'blocks_task_id');

const taskRelation = table('task_relations')
  .columns({
    task_id_1: string(),
    task_id_2: string(),
  })
  .primaryKey('task_id_1', 'task_id_2');

// Relationships for query traversal (NOT enforced client-side — Postgres enforces FKs)
const taskRelationships = relationships(task, ({ one, many }) => ({
  list: one({ sourceField: ['list_name'], destField: ['name'], destSchema: list }),
  parent: one({ sourceField: ['parent_id'], destField: ['id'], destSchema: task }),
  subtasks: many({ sourceField: ['id'], destSchema: task, destField: ['parent_id'] }),
}));

export const schema = createSchema({
  tables: [task, list, taskDependency, taskRelation],
  relationships: [taskRelationships],
});

// Single-user app — allow everything (empty arrays = DENY by default!)
export const permissions = definePermissions(schema, () => ({
  task: ANYONE_CAN_DO_ANYTHING,
  list: ANYONE_CAN_DO_ANYTHING,
  taskDependency: ANYONE_CAN_DO_ANYTHING,
  taskRelation: ANYONE_CAN_DO_ANYTHING,
}));
```

2. **Zero provider** in `apps/mobile/app/_layout.tsx`:

```typescript
import { ZeroProvider } from '@rocicorp/zero/react';
import { expoSQLiteStoreProvider } from '@rocicorp/zero/expo-sqlite';
import { schema } from '../src/zero-schema';

export default function RootLayout() {
  return (
    <ZeroProvider
      server={process.env.EXPO_PUBLIC_ZERO_SERVER_URL!}
      schema={schema}
      kvStore={expoSQLiteStoreProvider()}
      // Extend grace period for mobile (default 60s)
      disconnectTimeoutMs={120_000}
    >
      <App />
    </ZeroProvider>
  );
}
```

3. **Update `use-store.ts`** — replace Turso sync calls with Zero queries/mutations:
   - Reads: `useQuery(zero.query.task.where('is_trashed', 0))` instead of `getAllTasks(db)`
   - Writes: `zero.mutate.task.update({ id, status: newStatus })` instead of `setStatus(db, id, status)`
   - Remove: `syncWithCloud`, `pushTask`, `pushLists`, `pushAll` — Zero syncs automatically
   - Keep: local-only `config` and `undo_history` tables in separate `expo-sqlite` DB

4. **Keep local-only tables** in a separate expo-sqlite database (`tasker-local.db`) for `config`, `undo_history`, and list UI preferences (`is_collapsed`, `hide_completed`).

### Phase 2b: Offline UX

> **Research finding:** Zero writes are queued during `connecting` state (up to `disconnectTimeoutMs`), then **rejected** (not thrown — promises resolve with error result since v0.25). Brief interruptions (<60s) are invisible to users.

**Connection state timeline:**

| Time | State | Reads | Writes |
|------|-------|-------|--------|
| 0-120s offline | `connecting` | Yes | Yes (queued in memory) |
| >120s offline | `disconnected` | Yes | **Rejected** |
| Reconnect | `connected` | Yes | Yes (queued writes sent) |

**Implementation pattern — global offline banner:**

```typescript
import { useConnectionState } from '@rocicorp/zero/react';

function OfflineBanner() {
  const state = useConnectionState();
  const isOffline = state.name === 'disconnected' || state.name === 'error';

  if (!isOffline) return null;
  return (
    <View style={styles.banner}>
      <Text>Offline — changes won't be saved</Text>
      {state.name === 'error' && (
        <Pressable onPress={() => zero.connection.connect()}>
          <Text>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}
```

**Mutation pattern — check `.client` result:**

```typescript
const write = zero.mutate.task.update({ id: taskId, status: newStatus });
const result = await write.client;
if (result.type === 'error') {
  showStatus('Offline — change not saved');
}
```

### Phase 3: Desktop-to-Postgres Bridge

> **Research finding:** `@neondatabase/serverless` with `drizzle-orm/neon-http` is the best choice — HTTP transport (no TCP), type-safe queries, works well in Electron. SQLite triggers auto-set `updated_at` so existing `@tasker/core` queries need no changes.

**Approach:** chokidar watches SQLite file → timestamp-based push/pull to Postgres.

1. **Add `updated_at` column + trigger** to desktop SQLite schema:

```sql
-- Migration in packages/core/src/db.ts
ALTER TABLE tasks ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

CREATE TRIGGER IF NOT EXISTS tasks_updated_at
AFTER UPDATE ON tasks
BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_inserted_at
AFTER INSERT ON tasks
BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

2. **Bridge push** (desktop → Postgres):

```typescript
// apps/desktop/electron/sync/postgres-bridge.ts
import { neon } from '@neondatabase/serverless';
import { getConfig, setConfig } from '@tasker/core';

async function pushChanges(localDb: TaskerDb) {
  const lastSync = getConfig(localDb, 'last_sync') ?? '1970-01-01';
  const changed = localDb.all(
    sql`SELECT * FROM tasks WHERE updated_at > ${lastSync}`
  );

  const pg = neon(process.env.NEON_DATABASE_URL!);
  for (const task of changed) {
    await pg`INSERT INTO tasks ${pg(task)}
      ON CONFLICT (id) DO UPDATE SET ${pg(task)}
      WHERE excluded.updated_at > tasks.updated_at`;
  }

  setConfig(localDb, 'last_sync', new Date().toISOString());
}
```

3. **Bridge pull** (Postgres → desktop):

```typescript
async function pullChanges(localDb: TaskerDb) {
  const lastSync = getConfig(localDb, 'last_sync') ?? '1970-01-01';
  const pg = neon(process.env.NEON_DATABASE_URL!);
  const remote = await pg`SELECT * FROM tasks WHERE updated_at > ${lastSync}`;

  for (const task of remote) {
    // Upsert into local SQLite, only if remote is newer
    localDb.run(sql`INSERT OR REPLACE INTO tasks (...) VALUES (...)
      WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE id = ${task.id} AND updated_at > ${task.updated_at})`);
  }
}
```

4. **Watcher** triggers push/pull on SQLite file changes (debounced):

```
apps/desktop/electron/sync/
  postgres-bridge.ts  — push/pull logic (~200 lines)
  bridge-watcher.ts   — chokidar integration, debounced sync
```

### Phase 4: Cleanup

- Delete `apps/mobile/src/sync.ts` (Turso code)
- Remove Turso token from source and **rotate it** (it's committed in git history)
- Remove `pushTask`, `pushLists`, `pushAll` from store
- Remove PTR `syncWithCloud` calls — Zero syncs automatically. PTR becomes cosmetic (show "Up to date" toast).
- Update `.env` to use `EXPO_PUBLIC_ZERO_SERVER_URL`

## Technical Considerations

### Offline Behavior

Zero writes are **queued for ~2 min** during brief disconnections, then **rejected** (not thrown). For a personal task manager, this is acceptable.

- Use `useConnectionState()` to show offline banner + dim write UI
- Wrap mutations with `.client` result check
- Set `disconnectTimeoutMs: 120_000` (2 min) for mobile grace period
- Do **NOT** build a local write queue — it fights Zero's architecture and creates conflict issues
- If offline writes become a hard requirement, evaluate **PowerSync** or **Ditto** instead

### Schema Triple-Maintenance

Three schemas must stay in sync: Drizzle SQLite (core), Postgres, Zero (mobile). When adding a column:

1. Add to Postgres first (`ALTER TABLE`) — zero-cache detects automatically
2. Add to Zero schema in `apps/mobile/src/zero-schema.ts`
3. Deploy updated app — Zero handles client schema refresh
4. Add to Drizzle schema + migration in `packages/core/`

> **Research finding:** Always update Postgres before deploying app code. Otherwise clients enter a reload loop (rejected by zero-cache, reloads, rejected again). For React Native, handle `onUpdateNeeded` callback since there's no `location.reload()`.

### Local-Only Fields

`is_collapsed` and `hide_completed` on lists are per-device UI preferences. They are **excluded from Postgres and Zero schemas**. Stored in a local-only `tasker-local.db` sqlite database alongside `config` and `undo_history`.

### FK Constraints

Zero does **NOT enforce foreign keys client-side**. Relationships in the Zero schema are for query traversal only (`.related()`). Postgres enforces all FK constraints, CASCADE deletes, and CHECK constraints. If a client mutation violates a FK constraint, the server rejects it and the optimistic update is rolled back.

### Sort Order

Task `sort_order` syncs across devices (last-write-wins via Zero). List `sort_order` also syncs. If the user reorders on both devices, the last writer wins. Acceptable for a single-user app.

## Acceptance Criteria

- [ ] Postgres schema created with all 4 synced tables + triggers
- [ ] Existing desktop data seeded into Postgres
- [ ] `zero-cache` deployed on Fly.io and connecting to Postgres
- [ ] Mobile app reads tasks via Zero `useQuery` — data appears without manual pull
- [ ] Mobile task mutations sync to Postgres in real-time
- [ ] Offline banner shows when disconnected, writes disabled
- [ ] Desktop changes reach Postgres via bridge and appear on mobile
- [ ] Pull-to-refresh is cosmetic (shows "Up to date")
- [ ] `is_collapsed`/`hide_completed` persist locally, not synced
- [ ] `config` and `undo_history` remain local-only
- [ ] Turso code and token removed + rotated

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Zero offline write limitation | Users can't add tasks after 2min offline | Banner + disabled UI; acceptable for personal use |
| `zero-cache` downtime | App enters read-only mode | Fly.io uptime; same UX as offline |
| Schema drift between 3 definitions | Data corruption | Update Postgres first, then app; documented checklist |
| Desktop bridge complexity | New ~200-line component | chokidar + timestamp push/pull; well-understood pattern |
| Neon billing trap | Unexpected costs | Use Fly Postgres or Supabase instead of Neon free tier |
| Zero React Native maturity | Potential bugs | Official support + zslack example; active development |

## Infrastructure

- **Postgres:** TBD (Fly Postgres ~$3-7/mo, or Supabase free, or Neon Launch $19/mo)
- **zero-cache:** Fly.io shared-cpu-1x 512MB (~$3-5/mo)
- **SQLite replica volume:** 1GB on Fly ($0.15/mo)
- **Estimated monthly cost:** $3-12/mo depending on Postgres provider

## References

- [Zero docs — React Native](https://zero.rocicorp.dev/docs/react-native)
- [Zero docs — Schema](https://zero.rocicorp.dev/docs/schema)
- [Zero docs — Queries](https://zero.rocicorp.dev/docs/queries)
- [Zero docs — Custom Mutators](https://zero.rocicorp.dev/docs/custom-mutators)
- [Zero docs — Connection Status](https://zero.rocicorp.dev/docs/connection)
- [Zero docs — Deployment](https://zero.rocicorp.dev/docs/deployment)
- [Zero docs — Offline](https://zero.rocicorp.dev/docs/offline)
- [Zero docs — Permissions](https://zero.rocicorp.dev/docs/permissions)
- [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver)
- [Drizzle ORM + Neon HTTP](https://neon.com/docs/guides/drizzle)
- [Existing mobile plan](docs/plans/2026-03-17-feat-android-mobile-app-plan.md)
- [Mobile brainstorm](docs/brainstorms/2026-03-17-mobile-app-android-brainstorm.md)
