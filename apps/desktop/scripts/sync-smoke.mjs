/**
 * Integration smoke test for the desktop Supabase sync bridge.
 *
 * Validates the real mechanics against LIVE Supabase using a throwaway temp DB
 * (never touches the production tasker.db):
 *   - outbox triggers fire and stamp updated_at
 *   - push: outbox drain upserts the row to Supabase
 *   - pull: applying a remote row locally works AND does not re-enqueue (loop guard)
 *
 * The trigger/outbox SQL below MIRRORS electron/sync/supabase-sync.ts:initSyncObjects
 * (kept in sync manually). Run:  node scripts/sync-smoke.mjs   (from apps/desktop)
 */
import { createDb, getRawDb } from '@tasker/core';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const TEST_ID = '__smoke__';
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const ok = (m) => console.log('ok -', m);

// ── creds ──
const env = Object.fromEntries(
  readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const supabase = createClient(env.TASKER_SUPABASE_URL, env.TASKER_SUPABASE_KEY, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await supabase.auth.signInAnonymously();
if (authErr) fail('auth: ' + authErr.message);
supabase.realtime.setAuth(auth.session.access_token);

// ── temp local db with schema + sync objects ──
const dbPath = join(tmpdir(), `sync-smoke-${process.pid}.db`);
const db = createDb(dbPath);
const raw = getRawDb(db);
raw.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id=1), applying_remote INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO sync_state (id, applying_remote) VALUES (1, 0);
  CREATE TABLE IF NOT EXISTS sync_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT, pk TEXT, op TEXT, ts TEXT);
  CREATE TRIGGER _sync_tasks_ai AFTER INSERT ON tasks WHEN (SELECT applying_remote FROM sync_state)=0
  BEGIN
    UPDATE tasks SET updated_at = ${NOW} WHERE id = NEW.id;
    INSERT INTO sync_outbox (tbl,pk,op,ts) VALUES ('tasks', NEW.id, 'PUT', (SELECT updated_at FROM tasks WHERE id=NEW.id));
  END;
  CREATE TRIGGER _sync_tasks_ad AFTER DELETE ON tasks WHEN (SELECT applying_remote FROM sync_state)=0
  BEGIN INSERT INTO sync_outbox (tbl,pk,op,ts) VALUES ('tasks', OLD.id, 'DELETE', ${NOW}); END;
`);

const cleanup = async () => {
  try { await supabase.from('tasks').delete().eq('id', TEST_ID); } catch {}
  try { db; rmSync(dbPath, { force: true }); rmSync(dbPath + '-wal', { force: true }); rmSync(dbPath + '-shm', { force: true }); } catch {}
};

try {
  // ── PUSH: local insert → trigger enqueues + stamps updated_at ──
  raw.prepare(`INSERT INTO tasks (id, description, status, created_at, list_name) VALUES (?,?,?,?,?)`)
    .run(TEST_ID, 'smoke push', 0, new Date().toISOString(), 'tasks');
  const outbox = raw.prepare('SELECT * FROM sync_outbox WHERE pk=?').all(TEST_ID);
  if (outbox.length !== 1 || outbox[0].op !== 'PUT') fail('trigger did not enqueue one PUT');
  const local = raw.prepare('SELECT * FROM tasks WHERE id=?').get(TEST_ID);
  if (!local.updated_at) fail('trigger did not stamp updated_at');
  ok('trigger enqueued PUT + stamped updated_at=' + local.updated_at);

  const { error: upErr } = await supabase.from('tasks').upsert({
    id: local.id, description: local.description, status: local.status, created_at: local.created_at,
    list_name: local.list_name, due_date: local.due_date, priority: local.priority, tags: local.tags,
    is_trashed: local.is_trashed, sort_order: local.sort_order, completed_at: local.completed_at,
    parent_id: local.parent_id, updated_at: local.updated_at,
  });
  if (upErr) fail('push upsert: ' + JSON.stringify(upErr));
  const { data: remote1 } = await supabase.from('tasks').select('*').eq('id', TEST_ID).single();
  if (remote1?.description !== 'smoke push') fail('pushed row not found in Supabase');
  ok('push: row landed in Supabase');

  // ── PULL: remote edit → apply locally with loop guard ──
  const newer = new Date(Date.now() + 5000).toISOString();
  await supabase.from('tasks').update({ description: 'smoke pull edit', updated_at: newer }).eq('id', TEST_ID);
  const { data: remote2 } = await supabase.from('tasks').select('*').eq('id', TEST_ID).single();
  const seqBefore = raw.prepare('SELECT COALESCE(MAX(seq),0) m FROM sync_outbox').get().m;
  raw.prepare('UPDATE sync_state SET applying_remote=1').run();
  raw.prepare(`INSERT INTO tasks (id, description, status, created_at, list_name, due_date, priority, tags, is_trashed, sort_order, completed_at, parent_id, updated_at)
               VALUES (@id,@description,@status,@created_at,@list_name,@due_date,@priority,@tags,@is_trashed,@sort_order,@completed_at,@parent_id,@updated_at)
               ON CONFLICT(id) DO UPDATE SET description=excluded.description, status=excluded.status, created_at=excluded.created_at,
                 list_name=excluded.list_name, due_date=excluded.due_date, priority=excluded.priority, tags=excluded.tags,
                 is_trashed=excluded.is_trashed, sort_order=excluded.sort_order, completed_at=excluded.completed_at,
                 parent_id=excluded.parent_id, updated_at=excluded.updated_at`)
    .run({
      id: remote2.id, description: remote2.description, status: remote2.status, created_at: remote2.created_at,
      list_name: remote2.list_name, due_date: remote2.due_date, priority: remote2.priority, tags: remote2.tags,
      is_trashed: remote2.is_trashed, sort_order: remote2.sort_order, completed_at: remote2.completed_at,
      parent_id: remote2.parent_id, updated_at: remote2.updated_at,
    });
  raw.prepare('UPDATE sync_state SET applying_remote=0').run();

  const localAfter = raw.prepare('SELECT description FROM tasks WHERE id=?').get(TEST_ID);
  if (localAfter.description !== 'smoke pull edit') fail('pull did not apply remote edit locally');
  ok('pull: remote edit applied locally');

  const enqueuedByApply = raw.prepare('SELECT COUNT(*) c FROM sync_outbox WHERE seq > ?').get(seqBefore).c;
  if (enqueuedByApply !== 0) fail('loop guard failed: applying remote re-enqueued ' + enqueuedByApply + ' rows');
  ok('loop guard: remote apply did not re-enqueue');

  console.log('\nSYNC SMOKE PASSED');
} finally {
  await cleanup();
}
process.exit(0);
