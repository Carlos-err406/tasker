/**
 * Mobile database initialization using PowerSync (async).
 *
 * PowerSync manages sync with Supabase Postgres.
 * Uses SQL.js adapter in Expo Go (slow, no native modules needed).
 * Uses native adapter in dev/prod builds (fast).
 */

import { PowerSyncDatabase } from '@powersync/react-native';
import { SQLJSOpenFactory } from '@powersync/adapter-sql-js';
import Constants from 'expo-constants';
import { AppSchema } from './powersync-schema';
import { SupabaseConnector } from './supabase-connector';

const isExpoGo = Constants.executionEnvironment === 'storeClient';

export const powerSyncDb = new PowerSyncDatabase({
  schema: AppSchema,
  database: isExpoGo
    ? new SQLJSOpenFactory({ dbFilename: 'tasker-powersync.db' })
    : { dbFilename: 'tasker-powersync.db' },
});

let initialized = false;

export async function initSync() {
  if (initialized) return;
  await powerSyncDb.init();

  // Create local-only tables (not synced by PowerSync)
  await powerSyncDb.execute(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await powerSyncDb.execute(`
    CREATE TABLE IF NOT EXISTS undo_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stack_type TEXT NOT NULL CHECK(stack_type IN ('undo', 'redo')),
      command_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await powerSyncDb.execute(`
    INSERT OR IGNORE INTO lists (id, name, sort_order) VALUES ('tasks', 'tasks', 0);
  `);

  const connector = new SupabaseConnector();
  await powerSyncDb.connect(connector);
  initialized = true;
}
