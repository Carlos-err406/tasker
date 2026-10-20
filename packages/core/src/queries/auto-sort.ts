import type { TaskerDb } from '../db.js';
import { getSettings } from './settings-queries.js';
import { applySystemSort } from './task-queries.js';
import { applySystemSortAllLists } from './all-lists-order.js';

/** Apply system order everywhere when this device keeps lists auto-sorted. */
export function applyAutoSort(db: TaskerDb): void {
  if (!getSettings(db).autoSort) return;
  applySystemSort(db);
  applySystemSortAllLists(db);
}
