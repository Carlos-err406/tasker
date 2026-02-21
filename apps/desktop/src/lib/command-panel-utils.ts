import type { Task } from '@tasker/core/types';
import { TaskStatus } from '@tasker/core/types';
import { parseSearchFilters } from '@tasker/core/parsers';
import type { SearchFilters } from '@tasker/core/parsers';

/** Returns true if the input value is in command mode (starts with '>') */
export function isCommandMode(inputValue: string): boolean {
  return inputValue.startsWith('>');
}

/** Strips the '>' prefix and leading space to get the actual query */
export function getCommandQuery(inputValue: string): string {
  return inputValue.startsWith('>') ? inputValue.slice(1).trimStart() : inputValue;
}

/** Mirrors core's sortTasksForDisplay — InProgress first, then Pending by priority/due, then Done */
function sortForDisplay(tasks: Task[]): Task[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const statusOrder = (s: number) => s === TaskStatus.InProgress ? 0 : s === TaskStatus.Pending ? 1 : 2;
  const dueOrder = (d: string | null) => {
    if (!d) return 99;
    if (d < todayStr) return 0;
    return Math.round((new Date(d + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
  };
  const active = tasks
    .filter((t) => t.status !== TaskStatus.Done)
    .sort((a, b) => {
      const s = statusOrder(a.status) - statusOrder(b.status);
      if (s !== 0) return s;
      const pa = a.priority ?? 99, pb = b.priority ?? 99;
      if (pa !== pb) return pa - pb;
      const da = dueOrder(a.dueDate), db = dueOrder(b.dueDate);
      if (da !== db) return da - db;
      return b.createdAt.localeCompare(a.createdAt);
    });
  const done = tasks
    .filter((t) => t.status === TaskStatus.Done)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return [...active, ...done];
}

/** Returns true if all space-separated words in the query appear in the target string */
function matchesAll(target: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/);
  const t = target.toLowerCase();
  return words.every((w) => t.includes(w));
}

/**
 * Applies parsed search filters to a single task.
 * parentIds: set of task IDs that have at least one subtask (for has:subtasks).
 */
function matchesFilters(task: Task, filters: SearchFilters, parentIds: Set<string>): boolean {
  // Free-text description query (AND semantics, matches description or id)
  if (filters.descriptionQuery) {
    const target = task.description + ' ' + task.id;
    if (!matchesAll(target, filters.descriptionQuery)) return false;
  }

  // ID prefix filter (e.g. id:abc)
  if (filters.idPrefix !== null) {
    if (!task.id.startsWith(filters.idPrefix)) return false;
  }

  // Status
  if (filters.status !== null && task.status !== filters.status) return false;
  if (filters.notStatus !== null && task.status === filters.notStatus) return false;

  // Priority
  if (filters.priority !== null && task.priority !== filters.priority) return false;
  if (filters.notPriority !== null && task.priority === filters.notPriority) return false;

  // List
  if (filters.listName !== null && task.listName !== filters.listName) return false;
  if (filters.notListName !== null && task.listName === filters.notListName) return false;

  // Tags (positive — all specified tags must be present)
  if (filters.tags.length > 0) {
    if (!task.tags) return false;
    const lowerTags = task.tags.map((t) => t.toLowerCase());
    if (!filters.tags.every((ft) => lowerTags.includes(ft))) return false;
  }

  // Tags (negative — none of the negated tags may be present)
  if (filters.notTags.length > 0 && task.tags) {
    const lowerTags = task.tags.map((t) => t.toLowerCase());
    if (filters.notTags.some((nt) => lowerTags.includes(nt))) return false;
  }

  // Due date filter
  if (filters.dueFilter) {
    if (!task.dueDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    switch (filters.dueFilter) {
      case 'today':
        if (task.dueDate !== todayStr) return false;
        break;
      case 'overdue':
        if (task.dueDate >= todayStr) return false;
        break;
      case 'week': {
        const end = new Date(today);
        end.setDate(end.getDate() + 7);
        const endStr = end.toISOString().slice(0, 10);
        if (task.dueDate < todayStr || task.dueDate > endStr) return false;
        break;
      }
      case 'month': {
        const end = new Date(today);
        end.setDate(end.getDate() + 30);
        const endStr = end.toISOString().slice(0, 10);
        if (task.dueDate < todayStr || task.dueDate > endStr) return false;
        break;
      }
    }
  }

  // has:/notHas: filters
  if (filters.has.due && !task.dueDate) return false;
  if (filters.notHas.due && task.dueDate) return false;
  if (filters.has.tags && (!task.tags || task.tags.length === 0)) return false;
  if (filters.notHas.tags && task.tags && task.tags.length > 0) return false;
  if (filters.has.parent && !task.parentId) return false;
  if (filters.notHas.parent && task.parentId) return false;
  if (filters.has.subtasks && !parentIds.has(task.id)) return false;
  if (filters.notHas.subtasks && parentIds.has(task.id)) return false;

  return true;
}

/**
 * Filters tasks using the full filter syntax (tag:, status:, has:, etc.)
 * plus multi-word text matching — mirrors the server-side searchTasks logic.
 */
export function filterTasks(tasks: Task[], query: string): Task[] {
  const parentIds = new Set(tasks.filter((t) => t.parentId !== null).map((t) => t.parentId!));
  const filtered = query.trim()
    ? (() => {
        const filters = parseSearchFilters(query);
        return tasks.filter((t) => matchesFilters(t, filters, parentIds));
      })()
    : tasks;
  return sortForDisplay(filtered);
}

/** Filters items with a label field by matching all query words against label */
export function filterByLabel<T extends { label: string }>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  return items.filter((item) => matchesAll(item.label, query));
}
