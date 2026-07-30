/**
 * Mobile local database initialization.
 *
 * The app is offline-first: UI reads and writes a local SQLite database, while
 * custom-sync.ts mirrors changes to Supabase in the background.
 */

import * as SQLite from 'expo-sqlite';
import type { SQLiteBindValue } from 'expo-sqlite';
import { CREATE_SCHEMA_SQL } from '@tasker/core/db';

const DB_NAME = 'tasker-local.db';
const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

type BindParams = SQLiteBindValue[];

function normalizeParams(params?: BindParams): BindParams {
  return params ?? [];
}

async function initDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(CREATE_SCHEMA_SQL);
  await db.execAsync(`
    INSERT OR IGNORE INTO lists (name, sort_order) VALUES ('tasks', 0);

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      applying_remote INTEGER NOT NULL DEFAULT 0,
      initialized INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT,
      last_error TEXT
    );
    INSERT OR IGNORE INTO sync_state (id, applying_remote, initialized) VALUES (1, 0, 0);

    CREATE TABLE IF NOT EXISTS sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl TEXT NOT NULL,
      pk TEXT NOT NULL,
      op TEXT NOT NULL,
      ts TEXT NOT NULL
    );
  `);

  await runMigration(db, 'ALTER TABLE tasks ADD COLUMN updated_at TEXT');
  await runMigration(db, 'ALTER TABLE lists ADD COLUMN updated_at TEXT');
  await runMigration(db, 'ALTER TABLE sync_state ADD COLUMN initialized INTEGER NOT NULL DEFAULT 0');
  await runMigration(db, 'ALTER TABLE sync_state ADD COLUMN last_sync_at TEXT');
  await runMigration(db, 'ALTER TABLE sync_state ADD COLUMN last_error TEXT');

  await db.runAsync('UPDATE sync_state SET applying_remote = 0 WHERE id = 1');
  await createOutboxTriggers(db);
}

async function runMigration(db: SQLite.SQLiteDatabase, sql: string): Promise<void> {
  try {
    await db.execAsync(sql);
  } catch {
    // Already migrated.
  }
}

async function createOutboxTriggers(db: SQLite.SQLiteDatabase): Promise<void> {
  const guard = `WHEN (SELECT applying_remote FROM sync_state WHERE id = 1) = 0`;

  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS _sync_tasks_ai AFTER INSERT ON tasks ${guard}
    BEGIN
      UPDATE tasks SET updated_at = ${NOW_SQL} WHERE id = NEW.id;
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('tasks', NEW.id, 'PUT', (SELECT updated_at FROM tasks WHERE id = NEW.id));
    END;
    CREATE TRIGGER IF NOT EXISTS _sync_tasks_au AFTER UPDATE ON tasks ${guard}
    BEGIN
      UPDATE tasks SET updated_at = ${NOW_SQL} WHERE id = NEW.id;
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('tasks', NEW.id, 'PUT', (SELECT updated_at FROM tasks WHERE id = NEW.id));
    END;
    CREATE TRIGGER IF NOT EXISTS _sync_tasks_ad AFTER DELETE ON tasks ${guard}
    BEGIN
      INSERT INTO sync_outbox (tbl, pk, op, ts) VALUES ('tasks', OLD.id, 'DELETE', ${NOW_SQL});
    END;

    CREATE TRIGGER IF NOT EXISTS _sync_lists_ai AFTER INSERT ON lists ${guard}
    BEGIN
      UPDATE lists SET updated_at = ${NOW_SQL} WHERE name = NEW.name;
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('lists', NEW.name, 'PUT', (SELECT updated_at FROM lists WHERE name = NEW.name));
    END;
    CREATE TRIGGER IF NOT EXISTS _sync_lists_au AFTER UPDATE ON lists ${guard}
    BEGIN
      UPDATE lists SET updated_at = ${NOW_SQL} WHERE name = NEW.name;
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('lists', NEW.name, 'PUT', (SELECT updated_at FROM lists WHERE name = NEW.name));
    END;
    CREATE TRIGGER IF NOT EXISTS _sync_lists_ad AFTER DELETE ON lists ${guard}
    BEGIN
      INSERT INTO sync_outbox (tbl, pk, op, ts) VALUES ('lists', OLD.name, 'DELETE', ${NOW_SQL});
    END;

    CREATE TRIGGER IF NOT EXISTS _sync_task_dependencies_ai AFTER INSERT ON task_dependencies ${guard}
    BEGIN
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('task_dependencies', NEW.task_id || '.' || NEW.blocks_task_id, 'PUT', ${NOW_SQL});
    END;
    CREATE TRIGGER IF NOT EXISTS _sync_task_dependencies_ad AFTER DELETE ON task_dependencies ${guard}
    BEGIN
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('task_dependencies', OLD.task_id || '.' || OLD.blocks_task_id, 'DELETE', ${NOW_SQL});
    END;

    CREATE TRIGGER IF NOT EXISTS _sync_task_relations_ai AFTER INSERT ON task_relations ${guard}
    BEGIN
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('task_relations', NEW.task_id_1 || '.' || NEW.task_id_2, 'PUT', ${NOW_SQL});
    END;
    CREATE TRIGGER IF NOT EXISTS _sync_task_relations_ad AFTER DELETE ON task_relations ${guard}
    BEGIN
      INSERT INTO sync_outbox (tbl, pk, op, ts)
        VALUES ('task_relations', OLD.task_id_1 || '.' || OLD.task_id_2, 'DELETE', ${NOW_SQL});
    END;
  `);
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await initDatabase(db);
      return db;
    });
  }
  return dbPromise;
}

export async function initSync(): Promise<void> {
  await getDatabase();
}

export const localDb = {
  async getAll<T = any>(sql: string, params?: BindParams): Promise<T[]> {
    const db = await getDatabase();
    return db.getAllAsync<T>(sql, normalizeParams(params));
  },

  async getOptional<T = any>(sql: string, params?: BindParams): Promise<T | undefined> {
    const db = await getDatabase();
    return (await db.getFirstAsync<T>(sql, normalizeParams(params))) ?? undefined;
  },

  async execute(sql: string, params?: BindParams): Promise<void> {
    const db = await getDatabase();
    if (params && params.length > 0) {
      await db.runAsync(sql, params);
    } else {
      await db.execAsync(sql);
    }
  },
};
