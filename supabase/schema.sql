-- =============================================================================
-- Tasker — Supabase Postgres schema (source of truth for PowerSync sync)
-- =============================================================================
-- Paste into the Supabase SQL Editor of the NEW project, then run.
--
-- Mirrors packages/core SQLite schema. Dates are stored as TEXT (ISO strings)
-- to match the app's SQLite/PowerSync client schema exactly (no type coercion).
--
-- Synced tables only: tasks, lists, task_dependencies, task_relations.
-- Local-only tables (config, undo_history, list UI prefs) are NOT synced and
-- are NOT created here.
-- =============================================================================

-- ---- Tables -----------------------------------------------------------------

CREATE TABLE lists (
  name           TEXT PRIMARY KEY,
  is_collapsed   INTEGER DEFAULT 0,   -- local UI pref (not synced; kept for parity)
  hide_completed INTEGER DEFAULT 0,   -- local UI pref (not synced; kept for parity)
  sort_order     INTEGER DEFAULT 0
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  status       INTEGER DEFAULT 0,     -- 0=Pending 1=InProgress 2=Done 3=WontDo
  created_at   TEXT NOT NULL,
  list_name    TEXT NOT NULL REFERENCES lists(name) ON UPDATE CASCADE ON DELETE CASCADE,
  due_date     TEXT,
  priority     INTEGER,
  tags         TEXT,                  -- JSON array stored as text
  is_trashed   INTEGER DEFAULT 0,
  sort_order   INTEGER DEFAULT 0,
  completed_at TEXT,
  parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  updated_at   TEXT                   -- required by the PowerSync client schema
);

CREATE TABLE task_dependencies (
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocks_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocks_task_id),
  CHECK (task_id <> blocks_task_id)
);

CREATE TABLE task_relations (
  task_id_1 TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_id_2 TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id_1, task_id_2),
  CHECK (task_id_1 < task_id_2),
  CHECK (task_id_1 <> task_id_2)
);

CREATE INDEX idx_tasks_list_name  ON tasks (list_name);
CREATE INDEX idx_tasks_is_trashed ON tasks (is_trashed);
CREATE INDEX idx_tasks_parent_id  ON tasks (parent_id);

-- ---- Row Level Security -----------------------------------------------------
-- Single shared dataset accessed via anonymous Supabase auth. Every signed-in
-- (incl. anonymous) client may read/write all rows. Tighten later if the app
-- becomes multi-user (add a user_id column + owner policies).

ALTER TABLE lists             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_relations    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated all" ON lists             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated all" ON tasks             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated all" ON task_dependencies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated all" ON task_relations    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- PowerSync logical replication ------------------------------------------
-- PowerSync replicates via Postgres logical replication. REPLICA IDENTITY FULL
-- ensures full row images on UPDATE/DELETE. The `powersync` publication is what
-- the PowerSync instance subscribes to (name it exactly `powersync`).

ALTER TABLE lists             REPLICA IDENTITY FULL;
ALTER TABLE tasks             REPLICA IDENTITY FULL;
ALTER TABLE task_dependencies REPLICA IDENTITY FULL;
ALTER TABLE task_relations    REPLICA IDENTITY FULL;

CREATE PUBLICATION powersync FOR TABLE lists, tasks, task_dependencies, task_relations;
