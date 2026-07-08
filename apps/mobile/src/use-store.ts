/**
 * Central task store for the mobile app.
 * Uses PowerSync's async raw SQL for all database operations.
 * PowerSync handles sync with Supabase Postgres automatically.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Task, TaskStatus } from '@tasker/core/types';
import { TaskStatus as TS } from '@tasker/core/types';
import { generateId } from '@tasker/core/queries';
import { parseTaskDescription, getDisplayDescription } from '@tasker/core/parsers';
import { powerSyncDb, initSync } from './db';

// ─── Types & Helpers ────────────────────────────────────────────────────────

interface ListMetadata { name: string; isCollapsed: boolean; hideCompleted: boolean; sortOrder: number; }

/** Map a raw DB row to a Task object (column names → camelCase) */
function rowToTask(r: any): Task {
  return {
    id: r.id,
    description: r.description,
    status: r.status as TaskStatus,
    createdAt: r.created_at,
    listName: r.list_name,
    dueDate: r.due_date ?? null,
    priority: r.priority ?? null,
    tags: r.tags ? (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) : null,
    isTrashed: r.is_trashed ?? 0,
    sortOrder: r.sort_order ?? 0,
    completedAt: r.completed_at ?? null,
    parentId: r.parent_id ?? null,
  };
}

// ─── Async DB operations (PowerSync raw SQL) ────────────────────────────────

async function dbGetAllTasks(): Promise<Task[]> {
  const rows = await powerSyncDb.getAll<any>(
    'SELECT * FROM tasks WHERE is_trashed = 0 ORDER BY sort_order DESC',
  );
  return rows.map(rowToTask);
}

async function dbSearchTasks(query: string): Promise<Task[]> {
  const rows = await powerSyncDb.getAll<any>(
    'SELECT * FROM tasks WHERE is_trashed = 0 AND description LIKE ? ORDER BY sort_order DESC',
    [`%${query}%`],
  );
  return rows.map(rowToTask);
}

async function dbGetListsWithMetadata(): Promise<ListMetadata[]> {
  // Lists table in PowerSync: id (= name), name, sort_order
  // is_collapsed and hide_completed are local-only (stored in config as JSON)
  const rows = await powerSyncDb.getAll<any>(
    'SELECT id, name, sort_order FROM lists ORDER BY sort_order',
  );

  // Load local UI prefs from config
  const prefsRow = await powerSyncDb.getOptional<any>(
    "SELECT value FROM config WHERE key = 'list_prefs'",
  );
  const prefs: Record<string, { collapsed?: boolean; hideCompleted?: boolean }> = prefsRow
    ? JSON.parse(prefsRow.value)
    : {};

  const result = rows.map((r: any) => ({
    name: r.name ?? r.id,
    isCollapsed: prefs[r.name ?? r.id]?.collapsed ?? false,
    hideCompleted: prefs[r.name ?? r.id]?.hideCompleted ?? false,
    sortOrder: r.sort_order ?? 0,
  }));

  if (result.length === 0 || !result.some((r: ListMetadata) => r.name === 'tasks')) {
    result.unshift({ name: 'tasks', isCollapsed: false, hideCompleted: false, sortOrder: 0 });
  }

  return result;
}

async function dbGetDefaultList(): Promise<string> {
  const row = await powerSyncDb.getOptional<any>(
    "SELECT value FROM config WHERE key = 'default_list'",
  );
  return row?.value ?? 'tasks';
}

async function dbSetListPref(name: string, key: 'collapsed' | 'hideCompleted', value: boolean): Promise<void> {
  const prefsRow = await powerSyncDb.getOptional<any>(
    "SELECT value FROM config WHERE key = 'list_prefs'",
  );
  const prefs: Record<string, any> = prefsRow ? JSON.parse(prefsRow.value) : {};
  if (!prefs[name]) prefs[name] = {};
  prefs[name][key] = value;
  await powerSyncDb.execute(
    "INSERT OR REPLACE INTO config (key, value) VALUES ('list_prefs', ?)",
    [JSON.stringify(prefs)],
  );
}

async function dbAddTask(description: string, listName: string): Promise<Task> {
  const id = generateId();
  const now = new Date().toISOString();

  // Parse inline metadata
  const parsed = parseTaskDescription(description);

  // Ensure list exists
  await powerSyncDb.execute(
    'INSERT OR IGNORE INTO lists (id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists))',
    [listName, listName],
  );

  // Get next sort_order
  const maxRow = await powerSyncDb.getOptional<any>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM tasks WHERE list_name = ? AND is_trashed = 0',
    [listName],
  );
  const sortOrder = maxRow?.next ?? 0;

  await powerSyncDb.execute(
    'INSERT INTO tasks (id, description, status, created_at, list_name, due_date, priority, tags, is_trashed, sort_order, completed_at, parent_id) VALUES (?, ?, 0, ?, ?, ?, ?, ?, 0, ?, NULL, ?)',
    [id, description, now, listName, parsed.dueDate ?? null, parsed.priority ?? null, parsed.tags?.length ? JSON.stringify(parsed.tags) : null, sortOrder, parsed.parentId ?? null],
  );

  return {
    id, description, status: TS.Pending, createdAt: now, listName,
    dueDate: parsed.dueDate ?? null, priority: parsed.priority ?? null,
    tags: parsed.tags?.length ? JSON.stringify(parsed.tags) : null,
    isTrashed: 0, sortOrder, completedAt: null, parentId: parsed.parentId ?? null,
  };
}

async function dbSetStatus(taskId: string, status: TaskStatus): Promise<void> {
  const completedAt = (status === TS.Done || status === TS.WontDo) ? new Date().toISOString() : null;
  await powerSyncDb.execute(
    'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?',
    [status, completedAt, taskId],
  );
}

async function dbDeleteTask(taskId: string): Promise<void> {
  await powerSyncDb.execute('UPDATE tasks SET is_trashed = 1 WHERE id = ?', [taskId]);
}

async function dbRenameTask(taskId: string, description: string): Promise<void> {
  const parsed = parseTaskDescription(description);
  await powerSyncDb.execute(
    'UPDATE tasks SET description = ?, due_date = ?, priority = ?, tags = ? WHERE id = ?',
    [description, parsed.dueDate ?? null, parsed.priority ?? null, parsed.tags?.length ? JSON.stringify(parsed.tags) : null, taskId],
  );
}

async function dbMoveTask(taskId: string, targetList: string): Promise<void> {
  await powerSyncDb.execute(
    'INSERT OR IGNORE INTO lists (id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists))',
    [targetList, targetList],
  );
  await powerSyncDb.execute('UPDATE tasks SET list_name = ? WHERE id = ?', [targetList, taskId]);
}

async function dbCreateList(name: string): Promise<void> {
  await powerSyncDb.execute(
    'INSERT INTO lists (id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists))',
    [name, name],
  );
}

async function dbDeleteList(name: string): Promise<void> {
  await powerSyncDb.execute('DELETE FROM tasks WHERE list_name = ?', [name]);
  await powerSyncDb.execute('DELETE FROM lists WHERE id = ?', [name]);
}

async function dbRenameList(oldName: string, newName: string): Promise<void> {
  // PowerSync uses id as PK, and tasks reference list_name
  await powerSyncDb.execute('UPDATE tasks SET list_name = ? WHERE list_name = ?', [newName, oldName]);
  await powerSyncDb.execute('INSERT INTO lists (id, name, sort_order) SELECT ?, ?, sort_order FROM lists WHERE id = ?', [newName, newName, oldName]);
  await powerSyncDb.execute('DELETE FROM lists WHERE id = ?', [oldName]);
}

async function dbGetTrash(): Promise<Task[]> {
  const rows = await powerSyncDb.getAll<any>('SELECT * FROM tasks WHERE is_trashed = 1 ORDER BY sort_order DESC');
  return rows.map(rowToTask);
}

async function dbRestoreFromTrash(taskId: string): Promise<void> {
  await powerSyncDb.execute('UPDATE tasks SET is_trashed = 0 WHERE id = ?', [taskId]);
}

async function dbClearTrash(): Promise<number> {
  const rows = await powerSyncDb.getAll<any>('SELECT id FROM tasks WHERE is_trashed = 1');
  await powerSyncDb.execute('DELETE FROM tasks WHERE is_trashed = 1');
  return rows.length;
}

// ─── Reducer ────────────────────────────────────────────────────────────────

interface StoreState {
  tasks: Task[];
  lists: string[];
  defaultList: string;
  collapsedLists: Set<string>;
  hideCompletedLists: Set<string>;
  searchQuery: string;
  statusMessage: string;
  loading: boolean;
}

type Action =
  | { type: 'SET_TASKS'; tasks: Task[] }
  | { type: 'SET_LISTS'; lists: string[] }
  | { type: 'SET_DEFAULT_LIST'; name: string }
  | { type: 'SET_COLLAPSED_MAP'; map: Map<string, boolean> }
  | { type: 'SET_HIDE_COMPLETED_MAP'; map: Map<string, boolean> }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_STATUS_MESSAGE'; message: string }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'UPDATE_TASK_STATUS'; taskId: string; status: TaskStatus }
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'REMOVE_TASK'; taskId: string }
  | { type: 'UPDATE_TASK'; taskId: string; changes: Partial<Task> };

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.type) {
    case 'SET_TASKS':
      return { ...state, tasks: action.tasks };
    case 'SET_LISTS':
      return { ...state, lists: action.lists };
    case 'SET_DEFAULT_LIST':
      return { ...state, defaultList: action.name };
    case 'SET_COLLAPSED_MAP': {
      const set = new Set<string>();
      for (const [name, collapsed] of action.map) {
        if (collapsed) set.add(name);
      }
      return { ...state, collapsedLists: set };
    }
    case 'SET_HIDE_COMPLETED_MAP': {
      const set = new Set<string>();
      for (const [name, hide] of action.map) {
        if (hide) set.add(name);
      }
      return { ...state, hideCompletedLists: set };
    }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };
    case 'SET_STATUS_MESSAGE':
      return { ...state, statusMessage: action.message };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'UPDATE_TASK_STATUS':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: action.status } : t,
        ),
      };
    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks] };
    case 'REMOVE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.taskId) };
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, ...action.changes } : t,
        ),
      };
  }
}

const initialState: StoreState = {
  tasks: [],
  lists: [],
  defaultList: 'tasks',
  collapsedLists: new Set(),
  hideCompletedLists: new Set(),
  searchQuery: '',
  statusMessage: '',
  loading: true,
};

// ─── Store hook ─────────────────────────────────────────────────────────────

export function useStore() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showStatus = useCallback((message: string) => {
    dispatch({ type: 'SET_STATUS_MESSAGE', message });
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => {
      dispatch({ type: 'SET_STATUS_MESSAGE', message: '' });
    }, 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const listMeta = await dbGetListsWithMetadata();
      const listNames = listMeta.map((l) => l.name);
      dispatch({ type: 'SET_LISTS', lists: listNames });
      dispatch({ type: 'SET_DEFAULT_LIST', name: await dbGetDefaultList() });

      const collapsedMap = new Map(listMeta.map((l) => [l.name, l.isCollapsed]));
      dispatch({ type: 'SET_COLLAPSED_MAP', map: collapsedMap });

      const hideMap = new Map(listMeta.map((l) => [l.name, l.hideCompleted]));
      dispatch({ type: 'SET_HIDE_COMPLETED_MAP', map: hideMap });

      const tasks = state.searchQuery
        ? await dbSearchTasks(state.searchQuery)
        : await dbGetAllTasks();

      dispatch({ type: 'SET_TASKS', tasks });
    } catch (err) {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.searchQuery, showStatus]);

  // On mount: initialize PowerSync, then refresh
  useEffect(() => {
    initSync()
      .then(() => refresh())
      .catch((err) => {
        console.warn('Sync init error:', err instanceof Error ? err.message : String(err));
        refresh();
      });
  }, []);

  // Task operations
  const addTask = useCallback(
    async (description: string, listName: string) => {
      try {
        const task = await dbAddTask(description, listName);
        dispatch({ type: 'ADD_TASK', task });
        showStatus(`Added: ${task.id.slice(0, 3)}`);
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [showStatus],
  );

  const toggleStatus = useCallback(
    async (taskId: string, currentStatus: TaskStatus) => {
      const newStatus = (currentStatus === TS.Done || currentStatus === TS.WontDo) ? TS.Pending : TS.Done;
      dispatch({ type: 'UPDATE_TASK_STATUS', taskId, status: newStatus });
      try {
        await dbSetStatus(taskId, newStatus);
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const setStatusTo = useCallback(
    async (taskId: string, status: TaskStatus) => {
      dispatch({ type: 'UPDATE_TASK_STATUS', taskId, status });
      try {
        await dbSetStatus(taskId, status);
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      dispatch({ type: 'REMOVE_TASK', taskId });
      showStatus('Deleted');
      try {
        await dbDeleteTask(taskId);
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const rename = useCallback(
    async (taskId: string, newDescription: string) => {
      dispatch({ type: 'UPDATE_TASK', taskId, changes: { description: newDescription } });
      try {
        await dbRenameTask(taskId, newDescription);
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const moveTask = useCallback(
    async (taskId: string, targetList: string) => {
      dispatch({ type: 'UPDATE_TASK', taskId, changes: { listName: targetList } });
      showStatus(`Moved to ${targetList}`);
      try {
        await dbMoveTask(taskId, targetList);
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const undoAction = useCallback(async () => {
    showStatus('Undo not yet supported with PowerSync');
  }, [showStatus]);

  const redoAction = useCallback(async () => {
    showStatus('Redo not yet supported with PowerSync');
  }, [showStatus]);

  const createList = useCallback(
    async (name: string) => {
      try {
        await dbCreateList(name);
        showStatus(`Created list "${name}"`);
        await refresh();
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [refresh, showStatus],
  );

  const deleteListAction = useCallback(
    async (name: string) => {
      try {
        await dbDeleteList(name);
        showStatus(`Deleted list "${name}"`);
        await refresh();
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [refresh, showStatus],
  );

  const renameListAction = useCallback(
    async (oldName: string, newName: string) => {
      try {
        await dbRenameList(oldName, newName);
        showStatus(`Renamed to "${newName}"`);
        await refresh();
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [refresh, showStatus],
  );

  const toggleCollapsed = useCallback(
    (name: string) => {
      const collapsed = !state.collapsedLists.has(name);
      const next = new Map(state.lists.map(n => [n, n === name ? collapsed : state.collapsedLists.has(n)]));
      dispatch({ type: 'SET_COLLAPSED_MAP', map: next });
      dbSetListPref(name, 'collapsed', collapsed);
    },
    [state.lists, state.collapsedLists],
  );

  const toggleHideCompleted = useCallback(
    (name: string) => {
      const hide = !state.hideCompletedLists.has(name);
      const next = new Map(state.lists.map(n => [n, n === name ? hide : state.hideCompletedLists.has(n)]));
      dispatch({ type: 'SET_HIDE_COMPLETED_MAP', map: next });
      dbSetListPref(name, 'hideCompleted', hide);
    },
    [state.lists, state.hideCompletedLists],
  );

  const toggleCollapseAll = useCallback(() => {
    const allCollapsed = state.lists.every((name) => state.collapsedLists.has(name));
    const target = !allCollapsed;
    const next = new Map(state.lists.map(n => [n, target]));
    dispatch({ type: 'SET_COLLAPSED_MAP', map: next });
    for (const name of state.lists) {
      dbSetListPref(name, 'collapsed', target);
    }
  }, [state.lists, state.collapsedLists]);

  const applySystemSort = useCallback(async () => {
    showStatus('System sort not yet supported with PowerSync');
  }, [showStatus]);

  const setSearch = useCallback((query: string) => {
    dispatch({ type: 'SET_SEARCH', query });
  }, []);

  const getTrashItems = useCallback(() => {
    return dbGetTrash();
  }, []);

  const restoreTask = useCallback(
    async (taskId: string) => {
      try {
        await dbRestoreFromTrash(taskId);
        showStatus('Restored');
        await refresh();
      } catch (err) {
        showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [refresh, showStatus],
  );

  const clearTrash = useCallback(async () => {
    try {
      const count = await dbClearTrash();
      showStatus(`Deleted ${count} task${count !== 1 ? 's' : ''} permanently`);
    } catch (err) {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showStatus]);

  // Group tasks by list
  const tasksByList = state.lists.reduce<Record<string, Task[]>>((acc, listName) => {
    acc[listName] = state.tasks.filter((t) => t.listName === listName);
    return acc;
  }, {});

  const pendingCount = state.tasks.filter((t) => t.status === 0).length;
  const totalCount = state.tasks.length;

  return {
    ...state,
    tasksByList,
    pendingCount,
    totalCount,
    refresh,
    addTask,
    toggleStatus,
    setStatusTo,
    rename,
    deleteTask,
    moveTask,
    undo: undoAction,
    redo: redoAction,
    createList,
    deleteList: deleteListAction,
    renameList: renameListAction,
    toggleCollapsed,
    toggleCollapseAll,
    toggleHideCompleted,
    applySystemSort,
    setSearch,
    getTrashItems,
    restoreTask,
    clearTrash,
    showStatus,
  };
}
