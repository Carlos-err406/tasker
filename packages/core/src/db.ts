/**
 * Driver-agnostic database types and schema SQL.
 * This file has NO Node.js imports — safe for React Native / expo-sqlite.
 *
 * Platform-specific DB factories:
 * - Node.js (CLI + desktop): import from './db-node.js'
 * - React Native (mobile): use expo-sqlite + drizzle directly
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema/index.js';

/**
 * Driver-agnostic DB type.
 * Both better-sqlite3 and expo-sqlite produce BaseSQLiteDatabase<'sync', ...>.
 */
export type TaskerDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** The raw SQL to create the schema from scratch (for new databases and tests) */
export const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS lists (
    name TEXT PRIMARY KEY,
    is_collapsed INTEGER DEFAULT 0,
    hide_completed INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "tasks" (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    status INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    list_name TEXT NOT NULL REFERENCES lists(name) ON UPDATE CASCADE ON DELETE CASCADE,
    due_date TEXT,
    priority INTEGER,
    tags TEXT,
    is_trashed INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    completed_at TEXT,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_name ON tasks(list_name);
CREATE INDEX IF NOT EXISTS idx_tasks_is_trashed ON tasks(is_trashed);
CREATE INDEX IF NOT EXISTS idx_tasks_sort ON tasks(status, priority, due_date, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocks_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, blocks_task_id),
    CHECK (task_id != blocks_task_id)
);

CREATE TABLE IF NOT EXISTS task_relations (
    task_id_1 TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_id_2 TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id_1, task_id_2),
    CHECK (task_id_1 < task_id_2),
    CHECK (task_id_1 != task_id_2)
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stack_type TEXT NOT NULL CHECK(stack_type IN ('undo', 'redo')),
    command_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_undo_stack_type ON undo_history(stack_type);
`;
