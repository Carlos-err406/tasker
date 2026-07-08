/**
 * Per-table sync descriptors shared by the push (drain) and pull (realtime/reconcile) paths.
 *
 * Local `tasker.db` columns are already snake_case (raw SQL, not Drizzle), and the
 * Supabase Postgres columns use the same names, so mapping is a straight column pick —
 * no camelCase conversion. The only special cases:
 *   - `lists`: only name/sort_order/updated_at sync; is_collapsed/hide_completed are
 *     per-device UI prefs and stay local (mirrors the mobile client).
 *   - junction tables: the PowerSync/outbox `id` is the composite "a.b" (matches
 *     mobile's supabase-connector `toSupabaseRow`).
 */

export interface SyncTable {
  /** Table name (identical in tasker.db and Supabase). */
  name: string;
  /** Primary-key columns. */
  pkCols: string[];
  /** All columns that sync (superset that includes the pk columns). */
  columns: string[];
  /** Whether the table carries an `updated_at` column for last-write-wins. */
  hasUpdatedAt: boolean;
  /** Build the outbox/composite pk string from a snake_case row. */
  joinPk(row: Record<string, any>): string;
  /** Parse an outbox pk string back into a { col: value } filter. */
  splitPk(pk: string): Record<string, string>;
}

export const SYNC_TABLES: SyncTable[] = [
  {
    name: 'tasks',
    pkCols: ['id'],
    columns: [
      'id', 'description', 'status', 'created_at', 'list_name', 'due_date',
      'priority', 'tags', 'is_trashed', 'sort_order', 'completed_at', 'parent_id', 'updated_at',
    ],
    hasUpdatedAt: true,
    joinPk: (r) => String(r['id']),
    splitPk: (pk) => ({ id: pk }),
  },
  {
    name: 'lists',
    pkCols: ['name'],
    columns: ['name', 'sort_order', 'updated_at'],
    hasUpdatedAt: true,
    joinPk: (r) => String(r['name']),
    splitPk: (pk) => ({ name: pk }),
  },
  {
    name: 'task_dependencies',
    pkCols: ['task_id', 'blocks_task_id'],
    columns: ['task_id', 'blocks_task_id'],
    hasUpdatedAt: false,
    joinPk: (r) => `${r['task_id']}.${r['blocks_task_id']}`,
    splitPk: (pk) => { const [a, b] = pk.split('.'); return { task_id: a!, blocks_task_id: b! }; },
  },
  {
    name: 'task_relations',
    pkCols: ['task_id_1', 'task_id_2'],
    columns: ['task_id_1', 'task_id_2'],
    hasUpdatedAt: false,
    joinPk: (r) => `${r['task_id_1']}.${r['task_id_2']}`,
    splitPk: (pk) => { const [a, b] = pk.split('.'); return { task_id_1: a!, task_id_2: b! }; },
  },
];

export const TABLE_BY_NAME: Record<string, SyncTable> =
  Object.fromEntries(SYNC_TABLES.map((t) => [t.name, t]));

/** Pick the synced columns from a full local row into a Supabase payload. */
export function toRemoteRow(table: SyncTable, localRow: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const col of table.columns) out[col] = localRow[col] ?? null;
  return out;
}
