/**
 * One-time data migrations, run by every host when it opens a database
 * (and after restoring a backup). Driver-agnostic: no Node.js imports.
 */

import { sql } from 'drizzle-orm';
import { withTransaction, type TaskerDb } from './db.js';
import { migrateLegacyTaskRefs } from './parsers/task-description-parser.js';
import { canonical } from './sync/merge.js';
import { SYNC_SCHEMA_SQL } from './sync/store.js';
import { CHECKPOINT_FORMAT, type Checkpoint, type SyncRecord } from './sync/types.js';
import { migrateLegacyRecord } from './sync/validation.js';
import { isLegacyTaskId, migrateLegacyTaskId } from './task-id.js';

interface TaskRow {
  id: string;
  description: string;
  status: number | null;
  created_at: string;
  list_name: string;
  due_date: string | null;
  priority: number | null;
  tags: string | null;
  is_trashed: number | null;
  sort_order: number | null;
  completed_at: string | null;
  parent_id: string | null;
  updated_at: string | null;
}

/**
 * Move pre-1.4.0 task IDs (`9kf`) to the prefixed format (`tsk_9kf..`), with the
 * references in descriptions, relationships, sync state and per-device config.
 * Sync identities are kept, so other devices see no edits. Undo history is
 * cleared because its commands name the old IDs. Returns whether anything moved.
 */
export function migrateTaskIds(db: TaskerDb): boolean {
  return withTransaction(db, () => {
    const legacy = db.all<TaskRow>(sql`SELECT * FROM tasks`).filter((t) => isLegacyTaskId(t.id));
    if (legacy.length === 0) return false;
    const ids = new Map(legacy.map((t) => [t.id, migrateLegacyTaskId(t.id, t.created_at)]));
    const next = (id: string) => ids.get(id) ?? id;

    // Insert the renamed rows before removing the old ones so every foreign key stays valid.
    for (const t of legacy)
      db.run(
        sql`INSERT INTO tasks(id,description,status,created_at,list_name,due_date,priority,tags,is_trashed,sort_order,completed_at,parent_id,updated_at) VALUES(${next(t.id)},${migrateLegacyTaskRefs(t.description, (id) => ids.get(id))},${t.status},${t.created_at},${t.list_name},${t.due_date},${t.priority},${t.tags},${t.is_trashed},${t.sort_order},${t.completed_at},NULL,${t.updated_at ?? null})`,
      );
    for (const [old, id] of ids) db.run(sql`UPDATE tasks SET parent_id=${id} WHERE parent_id=${old}`);
    for (const t of legacy)
      if (t.parent_id) db.run(sql`UPDATE tasks SET parent_id=${next(t.parent_id)} WHERE id=${next(t.id)}`);
    for (const e of db.all<{ task_id: string; blocks_task_id: string }>(sql`SELECT * FROM task_dependencies`)) {
      if (!ids.has(e.task_id) && !ids.has(e.blocks_task_id)) continue;
      db.run(sql`DELETE FROM task_dependencies WHERE task_id=${e.task_id} AND blocks_task_id=${e.blocks_task_id}`);
      db.run(
        sql`INSERT OR IGNORE INTO task_dependencies(task_id,blocks_task_id) VALUES(${next(e.task_id)},${next(e.blocks_task_id)})`,
      );
    }
    for (const e of db.all<{ task_id_1: string; task_id_2: string }>(sql`SELECT * FROM task_relations`)) {
      if (!ids.has(e.task_id_1) && !ids.has(e.task_id_2)) continue;
      const [a, b] = [next(e.task_id_1), next(e.task_id_2)].sort() as [string, string];
      db.run(sql`DELETE FROM task_relations WHERE task_id_1=${e.task_id_1} AND task_id_2=${e.task_id_2}`);
      db.run(sql`INSERT OR IGNORE INTO task_relations(task_id_1,task_id_2) VALUES(${a},${b})`);
    }
    for (const old of ids.keys()) db.run(sql`DELETE FROM tasks WHERE id=${old}`);

    // Point sync aliases at the new local IDs. A task without one gets the identity
    // its old ID seeds, so a device that syncs for the first time after migrating
    // still matches devices that seeded before it.
    for (const statement of SYNC_SCHEMA_SQL) db.run(sql.raw(statement));
    for (const t of legacy) {
      const id = next(t.id);
      db.run(
        sql`INSERT INTO sync_aliases(kind,local_key,id,hint) SELECT kind,${id},id,hint FROM sync_aliases WHERE kind='task' AND local_key=${t.id} ON CONFLICT(kind,local_key) DO NOTHING`,
      );
      db.run(sql`DELETE FROM sync_aliases WHERE kind='task' AND local_key=${t.id}`);
      db.run(
        sql`INSERT INTO sync_aliases(kind,local_key,id,hint) VALUES('task',${id},${`legacy:task:${t.id}:${t.created_at}`},${t.created_at}) ON CONFLICT(kind,local_key) DO NOTHING`,
      );
    }
    for (const row of db.all<{ id: string; record_json: string }>(
      sql`SELECT id,record_json FROM sync_records WHERE kind='task'`,
    )) {
      const record = migrateLegacyRecord(JSON.parse(row.record_json) as SyncRecord);
      db.run(sql`UPDATE sync_records SET record_json=${canonical(record)} WHERE kind='task' AND id=${row.id}`);
    }
    const meta = (key: string) => db.get<{ value: string }>(sql`SELECT value FROM sync_meta WHERE key=${key}`)?.value;
    const setMeta = (key: string, value: string) => db.run(sql`UPDATE sync_meta SET value=${value} WHERE key=${key}`);
    const baseline = meta('baseline');
    if (baseline) setMeta('baseline', canonical((JSON.parse(baseline) as SyncRecord[]).map(migrateLegacyRecord)));
    const pending = meta('pending');
    if (pending) {
      const { id, checkpoint } = JSON.parse(pending) as { id: string; checkpoint: Checkpoint };
      if ((checkpoint.format as number) === 1)
        setMeta(
          'pending',
          canonical({
            id,
            checkpoint: { ...checkpoint, format: CHECKPOINT_FORMAT, records: checkpoint.records.map(migrateLegacyRecord) },
          }),
        );
    }

    // Per-device config that names tasks.
    const config = (key: string) => db.get<{ value: string }>(sql`SELECT value FROM config WHERE key=${key}`)?.value;
    const setConfig = (key: string, value: unknown) =>
      db.run(sql`UPDATE config SET value=${JSON.stringify(value)} WHERE key=${key}`);
    try {
      const order = JSON.parse(config('all_lists_order') ?? 'null') as unknown;
      if (Array.isArray(order)) setConfig('all_lists_order', order.map((id) => (typeof id === 'string' ? next(id) : id)));
    } catch {
      /* An unreadable saved order falls back to system order anyway. */
    }
    try {
      const delivered = JSON.parse(config('reminders:delivered') ?? 'null') as unknown;
      if (Array.isArray(delivered))
        setConfig(
          'reminders:delivered',
          delivered.map((r: { key?: unknown }) => {
            if (typeof r?.key !== 'string') return r;
            const at = r.key.indexOf('@');
            return at < 0 ? r : { ...r, key: next(r.key.slice(0, at)) + r.key.slice(at) };
          }),
        );
    } catch {
      /* Unreadable delivery records are already treated as empty. */
    }
    db.run(sql`DELETE FROM undo_history`);
    return true;
  });
}
