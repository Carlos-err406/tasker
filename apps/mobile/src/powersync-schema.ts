/**
 * PowerSync client-side schema — mirrors the Supabase Postgres tables.
 * PowerSync auto-adds an `id` column as TEXT primary key.
 *
 * Local-only tables (config, undo_history, list prefs) are NOT included here.
 */

import { column, Schema, Table } from '@powersync/react-native';

const tasks = new Table(
  {
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
  },
  { indexes: { list: ['list_name'], trashed: ['is_trashed'], sort: ['sort_order'] } },
);

const lists = new Table({
  // PowerSync `id` = list name (mapped via sync rules: SELECT name as id, ...).
  // We also store `name` as a regular column so core queries (WHERE name = ?) work.
  // Sync rule: SELECT name as id, name, sort_order FROM lists
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

export const AppSchema = new Schema({
  tasks,
  lists,
  task_dependencies,
  task_relations,
});

export type Database = (typeof AppSchema)['types'];
export type TaskRecord = Database['tasks'];
export type ListRecord = Database['lists'];
