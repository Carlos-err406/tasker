import { createClient } from '@supabase/supabase-js';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getDatabase } from './db';
import { SYNC_TABLES, TABLE_BY_NAME, SyncTable, toRemoteRow } from './sync-tables';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

type SyncStateSnapshot = {
  initialized: boolean;
  connected: boolean;
  connecting: boolean;
  lastSyncAt?: string;
  lastError?: string;
  uploadQueue: number;
};

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let connecting = false;
let connected = false;
let syncing = false;
let notifyChange: (() => void) | null = null;

export async function startCustomSync(onChange: () => void): Promise<void> {
  notifyChange = onChange;
  await getDatabase();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    await setSyncError('Missing mobile Supabase configuration');
    return;
  }

  if (client || connecting) return;
  connecting = true;

  try {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.session) throw new Error(error?.message ?? 'Anonymous sign-in failed');

    connected = true;
    subscribeRealtime();
    await reconcile();

    syncTimer = setInterval(() => {
      void reconcile();
    }, 5000);
  } catch (error) {
    connected = false;
    client = null;
    await setSyncError(error instanceof Error ? error.message : String(error));
  } finally {
    connecting = false;
  }
}

export function stopCustomSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (client && channel) void client.removeChannel(channel);
  channel = null;
  client = null;
  connected = false;
  connecting = false;
  notifyChange = null;
}

export async function getCustomSyncStatus(): Promise<SyncStateSnapshot> {
  const db = await getDatabase();
  const state = await db.getFirstAsync<{ initialized: number; last_sync_at?: string; last_error?: string }>(
    'SELECT initialized, last_sync_at, last_error FROM sync_state WHERE id = 1',
  );
  const outbox = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM sync_outbox');

  return {
    initialized: Boolean(state?.initialized),
    connected,
    connecting,
    lastSyncAt: state?.last_sync_at ?? undefined,
    lastError: state?.last_error ?? undefined,
    uploadQueue: outbox?.count ?? 0,
  };
}

async function reconcile(): Promise<void> {
  if (!client || syncing) return;
  syncing = true;
  try {
    const db = await getDatabase();
    const state = await db.getFirstAsync<{ initialized: number }>('SELECT initialized FROM sync_state WHERE id = 1');
    const outbox = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM sync_outbox');

    if (!state?.initialized && (outbox?.count ?? 0) === 0) {
      await replaceLocalWithRemote();
      await db.runAsync('DELETE FROM sync_outbox');
      await db.runAsync('UPDATE sync_state SET initialized = 1 WHERE id = 1');
    } else {
      await pullRemoteRows();
      if (!state?.initialized) await db.runAsync('UPDATE sync_state SET initialized = 1 WHERE id = 1');
    }

    await drainOutbox();
    await setSyncSuccess();
    notifyChange?.();
  } catch (error) {
    await setSyncError(error instanceof Error ? error.message : String(error));
  } finally {
    syncing = false;
  }
}

function subscribeRealtime(): void {
  if (!client) return;
  channel = client.channel('mobile-sync');

  for (const table of SYNC_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: table.name }, (payload) => {
      void (async () => {
        const changed = payload.eventType === 'DELETE'
          ? await applyRemoteDelete(table, payload.old as Record<string, any>)
          : await applyRemoteUpsert(table, payload.new as Record<string, any>);
        if (changed) notifyChange?.();
      })().catch((error) => {
        void setSyncError(error instanceof Error ? error.message : String(error));
      });
    });
  }

  channel.subscribe((status, error) => {
    connected = status === 'SUBSCRIBED';
    if (error) void setSyncError(error.message ?? String(error));
    if (status === 'SUBSCRIBED') void reconcile();
  });
}

async function pullRemoteRows(): Promise<void> {
  if (!client) return;
  for (const table of SYNC_TABLES) {
    const { data, error } = await client.from(table.name).select('*');
    if (error) throw new Error(`Fetch ${table.name}: ${error.message}`);
    for (const remote of data ?? []) await applyRemoteUpsert(table, remote as Record<string, any>);
  }
}

async function replaceLocalWithRemote(): Promise<void> {
  if (!client) return;
  const remoteByTable = new Map<string, Record<string, any>[]>();

  for (const table of SYNC_TABLES) {
    const { data, error } = await client.from(table.name).select('*');
    if (error) throw new Error(`Initial fetch ${table.name}: ${error.message}`);
    remoteByTable.set(table.name, (data ?? []) as Record<string, any>[]);
  }

  const db = await getDatabase();
  await withApplyingRemote(async () => {
    await db.execAsync(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM task_relations;
      DELETE FROM task_dependencies;
      DELETE FROM tasks;
      DELETE FROM lists;
    `);

    for (const table of SYNC_TABLES) {
      for (const remote of remoteByTable.get(table.name) ?? []) {
        await upsertLocal(table, remote);
      }
    }

    await db.execAsync('PRAGMA foreign_keys = ON;');
  });
}

async function drainOutbox(): Promise<void> {
  if (!client) return;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ seq: number; tbl: string; pk: string; op: string }>(
    'SELECT seq, tbl, pk, op FROM sync_outbox ORDER BY seq',
  );
  if (rows.length === 0) return;

  const maxSeq = rows[rows.length - 1]!.seq;
  const latest = new Map<string, { tbl: string; pk: string; op: string }>();
  for (const row of rows) latest.set(`${row.tbl}\0${row.pk}`, { tbl: row.tbl, pk: row.pk, op: row.op });

  for (const { tbl, pk, op } of latest.values()) {
    const table = TABLE_BY_NAME[tbl];
    if (!table) continue;
    const ok = op === 'DELETE' ? await pushDelete(table, pk) : await pushUpsert(table, pk);
    if (!ok) return;
  }

  await db.runAsync('DELETE FROM sync_outbox WHERE seq <= ?', maxSeq);
}

async function pushUpsert(table: SyncTable, pk: string): Promise<boolean> {
  if (!client) return false;
  const db = await getDatabase();
  const filter = table.splitPk(pk);
  const where = table.pkCols.map((col) => `${col} = ?`).join(' AND ');
  const localRow = await db.getFirstAsync<Record<string, any>>(
    `SELECT * FROM ${table.name} WHERE ${where}`,
    table.pkCols.map((col) => filter[col]),
  );
  if (!localRow) return true;

  const { error } = await client.from(table.name).upsert(toRemoteRow(table, localRow));
  if (error) {
    await setSyncError(`Push ${table.name}: ${error.message}`);
    return false;
  }
  return true;
}

async function pushDelete(table: SyncTable, pk: string): Promise<boolean> {
  if (!client) return false;
  const { error } = await client.from(table.name).delete().match(table.splitPk(pk));
  if (error) {
    await setSyncError(`Delete ${table.name}: ${error.message}`);
    return false;
  }
  return true;
}

async function applyRemoteUpsert(table: SyncTable, remote: Record<string, any>): Promise<boolean> {
  const pk = table.joinPk(remote);
  if (await hasPendingLocalChange(table, pk)) return false;

  if (table.hasUpdatedAt) {
    const db = await getDatabase();
    const filter = table.splitPk(pk);
    const where = table.pkCols.map((col) => `${col} = ?`).join(' AND ');
    const local = await db.getFirstAsync<{ updated_at?: string }>(
      `SELECT updated_at FROM ${table.name} WHERE ${where}`,
      table.pkCols.map((col) => filter[col]),
    );
    if (local?.updated_at && String(remote['updated_at'] ?? '') <= String(local.updated_at)) return false;
  }

  await withApplyingRemote(async () => {
    await upsertLocal(table, remote);
  });
  return true;
}

async function applyRemoteDelete(table: SyncTable, remote: Record<string, any>): Promise<boolean> {
  const pk = table.joinPk(remote);
  if (await hasPendingLocalChange(table, pk)) return false;

  const db = await getDatabase();
  const filter = table.splitPk(pk);
  const where = table.pkCols.map((col) => `${col} = ?`).join(' AND ');
  await withApplyingRemote(async () => {
    await db.runAsync(`DELETE FROM ${table.name} WHERE ${where}`, table.pkCols.map((col) => filter[col]));
  });
  return true;
}

async function upsertLocal(table: SyncTable, row: Record<string, any>): Promise<void> {
  const db = await getDatabase();
  const cols = table.columns;
  const placeholders = cols.map(() => '?').join(', ');
  const nonPk = cols.filter((col) => !table.pkCols.includes(col));
  const conflict = table.pkCols.join(', ');
  const setClause = nonPk.length
    ? `DO UPDATE SET ${nonPk.map((col) => `${col} = excluded.${col}`).join(', ')}`
    : 'DO NOTHING';
  await db.runAsync(
    `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflict}) ${setClause}`,
    cols.map((col) => row[col] ?? null),
  );
}

async function hasPendingLocalChange(table: SyncTable, pk: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ one: number }>(
    'SELECT 1 AS one FROM sync_outbox WHERE tbl = ? AND pk = ? LIMIT 1',
    table.name,
    pk,
  );
  return Boolean(row);
}

async function withApplyingRemote(fn: () => Promise<void>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE sync_state SET applying_remote = 1 WHERE id = 1');
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await fn();
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await db.runAsync('UPDATE sync_state SET applying_remote = 0 WHERE id = 1');
  }
}

async function setSyncSuccess(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE sync_state SET last_sync_at = ?, last_error = NULL WHERE id = 1',
    new Date().toISOString(),
  );
}

async function setSyncError(message: string): Promise<void> {
  const db = await getDatabase();
  console.warn('[TaskerSync]', message);
  await db.runAsync('UPDATE sync_state SET last_error = ? WHERE id = 1', message);
}
