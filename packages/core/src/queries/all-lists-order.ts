/**
 * Saved order of the cross-list "All lists" view.
 *
 * Stored per device in the config table (an ordered JSON array of task IDs) so
 * the task table, backups and sync format stay unchanged. Tasks that are not in
 * the saved order yet (new or synced from another device) appear at the top,
 * newest first. Without a saved order, the view starts in system order.
 */
import type { TaskerDb } from '../db.js';
import type { TaskId } from '../types/task.js';
import { getConfig, setConfig } from './config-queries.js';
import { getAllTasks } from './task-queries.js';
import { sortTasksForDisplay } from './task-helpers.js';

const KEY = 'all_lists_order';

function savedOrder(db: TaskerDb): string[] | null {
  const raw = getConfig(db, KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
  } catch {
    return null;
  }
}

/** Task IDs of every non-trashed task in "All lists" display order. */
export function getAllListsOrder(db: TaskerDb): TaskId[] {
  const tasks = getAllTasks(db);
  const saved = savedOrder(db);
  if (!saved) return sortTasksForDisplay(tasks).map((t) => t.id);
  const present = new Set(tasks.map((t) => t.id));
  const known = new Set(saved);
  const fresh = tasks
    .filter((t) => !known.has(t.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => t.id);
  return [...fresh, ...saved.filter((id) => present.has(id))];
}

function save(db: TaskerDb, ids: TaskId[]): void {
  setConfig(db, KEY, JSON.stringify(ids));
}

/** Move a task to a 0-based position in the "All lists" order. Returns its previous index. */
export function reorderAllListsTask(db: TaskerDb, taskId: TaskId, newIndex: number): number {
  const ids = getAllListsOrder(db);
  const oldIndex = ids.indexOf(taskId);
  if (oldIndex < 0) return -1;
  const clamped = Math.max(0, Math.min(newIndex, ids.length - 1));
  ids.splice(oldIndex, 1);
  ids.splice(clamped, 0, taskId);
  save(db, ids);
  return oldIndex;
}

/** System sort for the "All lists" view only; the lists' own orders are untouched. */
export function applySystemSortAllLists(db: TaskerDb): void {
  save(db, sortTasksForDisplay(getAllTasks(db)).map((t) => t.id));
}
