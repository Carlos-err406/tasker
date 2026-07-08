/**
 * Desktop ↔ Supabase sync via PowerSync Node SDK.
 *
 * Uses a custom worker (powersync-worker.ts) that only imports better-sqlite3,
 * avoiding the node:sqlite import that doesn't exist in Electron.
 *
 * PowerSync manages a SEPARATE SQLite database for sync. We merge its data
 * into the main Drizzle DB periodically so existing desktop queries work.
 */

import { PowerSyncDatabase } from '@powersync/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { column, Schema, Table } from '@powersync/node';
import type { TaskerDb } from '@tasker/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://uakpljdmkzoiwzumhkxk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0RD1n5LSoXDtF5E_mo5C3Q_3ZfWMzOv';
const POWERSYNC_URL = 'https://69bc1a53ec4d7e90e676c895.powersync.journeyapps.com';

// ─── PowerSync schema (mirrors mobile) ──────────────────────────────────────

const tasks = new Table({
  description: column.text,
  status: column.integer,
  created_at: column.text,
  list_name: column.text,
  due_date: column.text,
  priority: column.integer,
  tags: column.text,
  is_trashed: column.integer,
  sort_order: column.integer,
  completed_at: column.text,
  parent_id: column.text,
  updated_at: column.text,
}, { indexes: { list: ['list_name'] } });

const lists = new Table({
  name: column.text,
  sort_order: column.integer,
});

const task_dependencies = new Table({
  task_id: column.text,
  blocks_task_id: column.text,
});

const task_relations = new Table({
  task_id_1: column.text,
  task_id_2: column.text,
});

const psSchema = new Schema({ tasks, lists, task_dependencies, task_relations });

// ─── Supabase connector ─────────────────────────────────────────────────────

class DesktopSupabaseConnector {
  client: SupabaseClient;

  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  async fetchCredentials() {
    let { data: { session } } = await this.client.auth.getSession();
    if (!session) {
      const { data, error } = await this.client.auth.signInAnonymously();
      if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
      session = data.session;
    }
    return {
      endpoint: POWERSYNC_URL,
      token: session!.access_token,
    };
  }

  async uploadData(database: PowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    try {
      for (const op of transaction.crud) {
        const table = op.table;
        const data = table === 'lists'
          ? { name: op.id, ...op.opData }
          : { id: op.id, ...op.opData };
        const pk = table === 'lists' ? { name: op.id } : { id: op.id };

        if (op.op === 'PUT') {
          const { error } = await this.client.from(table).upsert(data);
          if (error) throw error;
        } else if (op.op === 'PATCH') {
          let q = this.client.from(table).update(op.opData);
          for (const [k, v] of Object.entries(pk)) q = q.eq(k, v);
          const { error } = await q;
          if (error) throw error;
        } else if (op.op === 'DELETE') {
          let q = this.client.from(table).delete();
          for (const [k, v] of Object.entries(pk)) q = q.eq(k, v);
          const { error } = await q;
          if (error) throw error;
        }
      }
      await transaction.complete();
    } catch (ex: any) {
      console.error('[sync] Upload error:', ex);
      if (/^2[234]/.test(ex?.code)) {
        await transaction.complete();
      } else {
        throw ex;
      }
    }
  }
}

// ─── Sync orchestration ─────────────────────────────────────────────────────

let psDb: PowerSyncDatabase | null = null;
let mergeInterval: ReturnType<typeof setInterval> | null = null;
let mainDb: TaskerDb | null = null;

function getRaw(db: TaskerDb): any {
  return (db as any).$client;
}

function notifyWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('db:changed');
  }
}

/** Merge PowerSync synced data → main Drizzle DB */
async function mergeToMainDb(): Promise<void> {
  if (!psDb || !mainDb) return;
  const raw = getRaw(mainDb);

  try {
    const psTasks = await psDb.getAll<any>('SELECT * FROM tasks');
    const psList = await psDb.getAll<any>('SELECT * FROM lists');

    if (psTasks.length === 0 && psList.length === 0) return;

    raw.exec('PRAGMA foreign_keys = OFF');

    for (const l of psList) {
      const name = l.name ?? l.id;
      const exists = raw.prepare('SELECT 1 FROM lists WHERE name = ?').get(name);
      if (exists) {
        raw.prepare('UPDATE lists SET sort_order = ? WHERE name = ?').run(l.sort_order ?? 0, name);
      } else {
        raw.prepare('INSERT INTO lists (name, sort_order) VALUES (?, ?)').run(name, l.sort_order ?? 0);
      }
    }

    const upsert = raw.prepare(`
      INSERT INTO tasks (id, description, status, created_at, list_name, due_date, priority, tags, is_trashed, sort_order, completed_at, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        description=excluded.description, status=excluded.status, list_name=excluded.list_name,
        due_date=excluded.due_date, priority=excluded.priority, tags=excluded.tags,
        is_trashed=excluded.is_trashed, sort_order=excluded.sort_order,
        completed_at=excluded.completed_at, parent_id=excluded.parent_id
    `);
    raw.transaction(() => {
      for (const t of psTasks) {
        upsert.run(t.id, t.description, t.status, t.created_at, t.list_name, t.due_date, t.priority, t.tags, t.is_trashed, t.sort_order, t.completed_at, t.parent_id);
      }
    })();

    raw.exec('PRAGMA foreign_keys = ON');
    notifyWindows();
    console.log(`[sync] Merged ${psTasks.length} tasks from PowerSync`);
  } catch (err) {
    console.warn('[sync] Merge error:', err);
  }
}

/** Push main DB changes → PowerSync (which syncs to Supabase) */
async function pushToSync(): Promise<void> {
  if (!psDb || !mainDb) return;
  const raw = getRaw(mainDb);

  try {
    const localTasks = raw.prepare('SELECT * FROM tasks').all() as any[];
    for (const t of localTasks) {
      await psDb.execute(
        `INSERT OR REPLACE INTO tasks (id, description, status, created_at, list_name, due_date, priority, tags, is_trashed, sort_order, completed_at, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.description, t.status, t.created_at, t.list_name, t.due_date, t.priority, t.tags, t.is_trashed, t.sort_order, t.completed_at, t.parent_id],
      );
    }

    const localLists = raw.prepare('SELECT name, sort_order FROM lists').all() as any[];
    for (const l of localLists) {
      await psDb.execute('INSERT OR REPLACE INTO lists (id, name, sort_order) VALUES (?, ?, ?)', [l.name, l.name, l.sort_order]);
    }
    console.log(`[sync] Pushed ${localTasks.length} tasks to PowerSync`);
  } catch (err) {
    console.warn('[sync] Push to PowerSync error:', err);
  }
}

export async function startSupabaseSync(db: TaskerDb): Promise<void> {
  mainDb = db;
  console.log('[sync] Starting PowerSync (Node) with custom worker...');

  try {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdirSync } = await import('node:fs');

    const syncDir = join(homedir(), 'Library', 'Application Support', 'cli-tasker');
    mkdirSync(syncDir, { recursive: true });

    psDb = new PowerSyncDatabase({
      schema: psSchema,
      database: {
        dbFilename: join(syncDir, 'powersync-desktop.db'),
        implementation: { type: 'better-sqlite3' },
        openWorker(_defaultWorkerPath: string, options: any) {
          const workerPath = join(__dirname, 'powersync-worker.cjs');
          console.log('[sync] Custom openWorker called, using:', workerPath);
          return new Worker(workerPath, options);
        },
      },
    });

    await psDb.init();
    console.log('[sync] PowerSync initialized');

    const connector = new DesktopSupabaseConnector();
    await psDb.connect(connector);
    console.log('[sync] PowerSync connected to Supabase');

    // Initial: push main DB to PowerSync, then wait for sync, then merge back
    await pushToSync();

    // Merge periodically (picks up mobile changes)
    mergeInterval = setInterval(() => {
      mergeToMainDb().catch(() => {});
    }, 10_000);

    // Also merge after initial sync delay
    setTimeout(() => mergeToMainDb(), 5000);
  } catch (err) {
    console.error('[sync] PowerSync init error:', err);
  }
}

export function stopSupabaseSync(): void {
  if (mergeInterval) { clearInterval(mergeInterval); mergeInterval = null; }
  psDb?.close();
  psDb = null;
  mainDb = null;
}

export function onMainDbChanged(): void {
  pushToSync().catch(() => {});
}
