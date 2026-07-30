export interface SyncTable {
  name: string;
  pkCols: string[];
  columns: string[];
  hasUpdatedAt: boolean;
  joinPk(row: Record<string, any>): string;
  splitPk(pk: string): Record<string, string>;
}

export const SYNC_TABLES: SyncTable[] = [
  {
    name: 'lists',
    pkCols: ['name'],
    columns: ['name', 'sort_order', 'updated_at'],
    hasUpdatedAt: true,
    joinPk: (row) => String(row['name']),
    splitPk: (pk) => ({ name: pk }),
  },
  {
    name: 'tasks',
    pkCols: ['id'],
    columns: [
      'id', 'description', 'status', 'created_at', 'list_name', 'due_date',
      'priority', 'tags', 'is_trashed', 'sort_order', 'completed_at', 'parent_id', 'updated_at',
    ],
    hasUpdatedAt: true,
    joinPk: (row) => String(row['id']),
    splitPk: (pk) => ({ id: pk }),
  },
  {
    name: 'task_dependencies',
    pkCols: ['task_id', 'blocks_task_id'],
    columns: ['task_id', 'blocks_task_id'],
    hasUpdatedAt: false,
    joinPk: (row) => `${row['task_id']}.${row['blocks_task_id']}`,
    splitPk: (pk) => {
      const [taskId, blocksTaskId] = pk.split('.');
      return { task_id: taskId!, blocks_task_id: blocksTaskId! };
    },
  },
  {
    name: 'task_relations',
    pkCols: ['task_id_1', 'task_id_2'],
    columns: ['task_id_1', 'task_id_2'],
    hasUpdatedAt: false,
    joinPk: (row) => `${row['task_id_1']}.${row['task_id_2']}`,
    splitPk: (pk) => {
      const [taskId1, taskId2] = pk.split('.');
      return { task_id_1: taskId1!, task_id_2: taskId2! };
    },
  },
];

export const TABLE_BY_NAME: Record<string, SyncTable> =
  Object.fromEntries(SYNC_TABLES.map((table) => [table.name, table]));

export function toRemoteRow(table: SyncTable, localRow: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const col of table.columns) out[col] = localRow[col] ?? null;
  return out;
}
