/**
 * Node.js-specific database factory using better-sqlite3.
 * CLI and desktop import from here. Mobile uses expo-sqlite directly.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';
import type { TaskerDb } from './db.js';
import { CREATE_SCHEMA_SQL } from './db.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

/** Returns the platform-appropriate default database path */
export function getDefaultDbPath(): string {
  if (process.env['TASKER_DB_PATH']) {
    return process.env['TASKER_DB_PATH'];
  }
  if (process.env['TASKER_TEST_MODE'] === '1') {
    throw new Error('TASKER_DB_PATH must be set when TASKER_TEST_MODE=1');
  }

  const platform = process.platform;
  let dir: string;

  if (platform === 'darwin') {
    dir = join(homedir(), 'Library', 'Application Support', 'cli-tasker');
  } else if (platform === 'win32') {
    dir = join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'cli-tasker');
  } else {
    // Linux / other
    dir = join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'cli-tasker');
  }

  return join(dir, 'tasker.db');
}

/**
 * Create a Drizzle database connection with proper pragmas.
 * If no path is given, uses the platform default.
 * Pass ':memory:' for in-memory databases (tests).
 */
export function createDb(path?: string): TaskerDb {
  const dbPath = path ?? getDefaultDbPath();

  // Ensure directory exists for file-based databases
  if (dbPath !== ':memory:') {
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    if (dir) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(dbPath);

  // Set pragmas — must happen on every connection
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  // Ensure schema exists (idempotent — all statements use IF NOT EXISTS)
  sqlite.exec(CREATE_SCHEMA_SQL);
  sqlite.exec(`INSERT OR IGNORE INTO lists (name, sort_order) VALUES ('tasks', 0)`);

  // Migrations for existing databases (safe to re-run — ALTER TABLE errors are caught)
  try { sqlite.exec(`ALTER TABLE lists ADD COLUMN hide_completed INTEGER DEFAULT 0`); } catch { /* column already exists */ }

  return drizzle(sqlite, { schema }) as unknown as TaskerDb;
}

/**
 * Create an in-memory database with schema applied. For tests.
 */
export function createTestDb(): TaskerDb {
  const db = createDb(':memory:');
  const raw = (db as any).$client as Database.Database;
  raw.exec(CREATE_SCHEMA_SQL);

  // Ensure default "tasks" list exists
  raw.exec(`INSERT OR IGNORE INTO lists (name, sort_order) VALUES ('tasks', 0)`);

  return db;
}

/** Sleep utility for retry logic */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff for SQLITE_BUSY errors.
 * Wraps write operations that may fail under concurrent access.
 */
export async function withRetry<T>(fn: () => T, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn();
    } catch (err: unknown) {
      const isBusy = err instanceof Error && 'code' in err && (err as any).code === 'SQLITE_BUSY';
      if (isBusy && i < maxRetries - 1) {
        await sleep(100 * Math.pow(2, i)); // 100ms, 200ms, 400ms
        continue;
      }
      throw err;
    }
  }
  throw new Error('withRetry: max retries exceeded');
}

/**
 * Get the raw Database instance from a Drizzle instance.
 * Node.js only — used by BackupManager and operations requiring raw better-sqlite3 access.
 */
export function getRawDb(db: TaskerDb): Database.Database {
  return (db as any).$client as Database.Database;
}

/**
 * Get the file path of the database.
 * libsql's db.name returns '' instead of the path, so we use pragma.
 */
export function getDbPath(db: TaskerDb): string {
  const raw = getRawDb(db);
  const list = raw.pragma('database_list') as Array<{ file: string }>;
  return list[0]?.file ?? '';
}
