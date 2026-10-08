import { getHost } from "../host.js";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Task, TaskStatus } from "@tasker/core/types";
import { TaskStatus as TS } from "@tasker/core/types";
import { parseTaskDescription } from "@tasker/core/parsers";
import { arrayMove } from "@dnd-kit/sortable";
import { ALL_LISTS } from "../lib/all-lists.js";
import * as taskService from "../lib/services/tasks.js";
import * as listService from "../lib/services/lists.js";
import * as undoService from "../lib/services/undo.js";

/** A single relationship entry for display: "(id) title" + status badge. */
export interface RelEntry {
  id: string;
  title: string;
  status: number;
}

/** All relationship details for a single task */
export interface TaskRelDetails {
  parent: RelEntry | null;
  subtasks: RelEntry[];
  blocks: RelEntry[];
  blockedBy: RelEntry[];
  related: RelEntry[];
}

interface TaskerState {
  tasks: Task[];
  lists: string[];
  defaultList: string;
  hideCompletedLists: Set<string>;
  relDetails: Record<string, TaskRelDetails>;
  searchQuery: string;
  statusMessage: string;
  selectedList: string;
  /** Saved "All lists" order (task IDs), device-local. */
  allOrder: string[];
  loading: boolean;
}

type Action =
  | {
      type: "LOAD";
      lists: string[];
      defaultList: string;
      tasks: Task[];
      hideCompleted: Set<string>;
      details: Record<string, TaskRelDetails>;
      selectedList: string;
      allOrder: string[];
    }
  | { type: "REORDER_ALL"; taskId: string; newIndex: number }
  | { type: "SET_HIDE_COMPLETED"; name: string; hide: boolean }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_STATUS_MESSAGE"; message: string }
  | { type: "SELECT_LIST"; list: string }
  | { type: "SET_LOADING"; loading: boolean }
  | {
      type: "REORDER_TASKS";
      listName: string;
      oldIndex: number;
      newIndex: number;
    }
  | { type: "REORDER_LISTS"; oldIndex: number; newIndex: number }
  | { type: "UPDATE_TASK_STATUS"; taskId: string; status: TaskStatus };

function reducer(state: TaskerState, action: Action): TaskerState {
  switch (action.type) {
    case "LOAD":
      return {
        ...state,
        lists: action.lists,
        defaultList: action.defaultList,
        tasks: action.tasks,
        hideCompletedLists: action.hideCompleted,
        relDetails: action.details,
        selectedList: action.selectedList,
        allOrder: action.allOrder,
        loading: false,
      };
    case "REORDER_ALL": {
      const ids = state.allOrder.filter((id) => id !== action.taskId);
      ids.splice(action.newIndex, 0, action.taskId);
      return { ...state, allOrder: ids };
    }
    case "SET_HIDE_COMPLETED": {
      const next = new Set(state.hideCompletedLists);
      if (action.hide) next.add(action.name);
      else next.delete(action.name);
      return { ...state, hideCompletedLists: next };
    }
    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };
    case "SET_STATUS_MESSAGE":
      return { ...state, statusMessage: action.message };
    case "SELECT_LIST":
      return { ...state, selectedList: action.list };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "REORDER_TASKS": {
      const { listName, oldIndex, newIndex } = action;
      const listTasks = state.tasks.filter((t) => t.listName === listName);
      const otherTasks = state.tasks.filter((t) => t.listName !== listName);
      const reordered = arrayMove(listTasks, oldIndex, newIndex);
      return { ...state, tasks: [...otherTasks, ...reordered] };
    }
    case "REORDER_LISTS":
      return {
        ...state,
        lists: arrayMove(state.lists, action.oldIndex, action.newIndex),
      };
    case "UPDATE_TASK_STATUS": {
      const updateEntry = (e: RelEntry): RelEntry =>
        e.id === action.taskId ? { ...e, status: action.status } : e;
      const updatedRel: Record<string, TaskRelDetails> = {};
      for (const [tid, det] of Object.entries(state.relDetails)) {
        updatedRel[tid] = {
          parent:
            det.parent && det.parent.id === action.taskId
              ? { ...det.parent, status: action.status }
              : det.parent,
          subtasks: det.subtasks.map(updateEntry),
          blocks: det.blocks.map(updateEntry),
          blockedBy: det.blockedBy.map(updateEntry),
          related: det.related.map(updateEntry),
        };
      }
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: action.status } : t,
        ),
        relDetails: updatedRel,
      };
    }
  }
}

const initialState: TaskerState = {
  tasks: [],
  lists: [],
  defaultList: "tasks",
  hideCompletedLists: new Set(),
  relDetails: {},
  searchQuery: "",
  statusMessage: "",
  selectedList: "tasks",
  allOrder: [],
  loading: true,
};

const HIDE_COMPLETED_ALL_KEY = "tasker:hideCompletedAll";
function readHideCompletedAll() {
  try {
    return localStorage.getItem(HIDE_COMPLETED_ALL_KEY) === "true";
  } catch {
    return false;
  }
}

export function useTaskerStore() {
  const [state, dispatch] = useReducer(reducer, initialState, (initial) => {
    let selectedList = initial.selectedList;
    let searchQuery = initial.searchQuery;
    try {
      selectedList =
        localStorage.getItem("tasker:selectedList") || selectedList;
      searchQuery = localStorage.getItem("tasker:searchQuery") || searchQuery;
    } catch {
      /* Storage may be unavailable. */
    }
    return { ...initial, selectedList, searchQuery };
  });
  const [isEditing, setIsEditing] = useState(false);
  const selectedListRef = useRef(state.selectedList);
  const refreshVersion = useRef(0);
  const searchQueryRef = useRef(state.searchQuery);
  const navigationTarget = useRef<string | null>(null);
  const selectList = useCallback((list: string) => {
    selectedListRef.current = list;
    dispatch({ type: "SELECT_LIST", list });
    try {
      localStorage.setItem("tasker:selectedList", list);
    } catch {
      /* Selection still works for this session. */
    }
  }, []);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const showStatus = useCallback((message: string) => {
    dispatch({ type: "SET_STATUS_MESSAGE", message });
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => {
      dispatch({ type: "SET_STATUS_MESSAGE", message: "" });
    }, 3000);
  }, []);

  const refresh = useCallback(
    async (overrides?: { searchQuery?: string }) => {
      const version = ++refreshVersion.current;
      try {
        const searchQuery = overrides?.searchQuery ?? searchQueryRef.current;

        const [lists, defaultList, allOrder] = await Promise.all([
          listService.getAllLists(),
          listService.getDefaultList(),
          taskService.getAllListsOrder(),
        ]);
        // Load hide-completed states
        const hideCompletedMap = new Map<string, boolean>();
        await Promise.all(
          lists.map(async (name) => {
            const hide = await listService.isListHideCompleted(name);
            hideCompletedMap.set(name, hide);
          }),
        );

        const tasks = searchQuery
          ? await taskService.searchTasks(searchQuery)
          : await taskService.getAllTasks();
        const details: Record<string, TaskRelDetails> = {};

        // Build relationship details by parsing descriptions + batch-fetching titles
        if (tasks.length > 0) {
          // Parse each task's description to extract relationship IDs
          const referencedIds = new Set<string>();
          const parsedMap = new Map<
            string,
            ReturnType<typeof parseTaskDescription>
          >();
          for (const t of tasks) {
            const parsed = parseTaskDescription(t.description);
            parsedMap.set(t.id, parsed);
            if (parsed.parentId) referencedIds.add(parsed.parentId);
            for (const id of parsed.hasSubtaskIds ?? []) referencedIds.add(id);
            for (const id of parsed.blocksIds ?? []) referencedIds.add(id);
            for (const id of parsed.blockedByIds ?? []) referencedIds.add(id);
            for (const id of parsed.relatedIds ?? []) referencedIds.add(id);
          }

          // Batch-fetch titles + statuses for all referenced task IDs
          const uniqueIds = [...referencedIds];
          const summaries =
            uniqueIds.length > 0
              ? await taskService.getTaskTitles(uniqueIds)
              : {};

          // Build details map
          const toEntry = (id: string): RelEntry => ({
            id,
            title: summaries[id]?.title ?? "?",
            status: summaries[id]?.status ?? 0,
          });
          for (const t of tasks) {
            const parsed = parsedMap.get(t.id)!;
            details[t.id] = {
              parent: parsed.parentId ? toEntry(parsed.parentId) : null,
              subtasks: (parsed.hasSubtaskIds ?? []).map(toEntry),
              blocks: (parsed.blocksIds ?? []).map(toEntry),
              blockedBy: (parsed.blockedByIds ?? []).map(toEntry),
              related: (parsed.relatedIds ?? []).map(toEntry),
            };
          }
        }

        // Reload undo history
        await undoService.reloadUndoHistory();
        if (version !== refreshVersion.current) return;
        const selectedList =
          selectedListRef.current === ALL_LISTS ||
          lists.includes(selectedListRef.current)
            ? selectedListRef.current
            : defaultList;
        selectList(selectedList);
        dispatch({
          type: "LOAD",
          lists,
          defaultList,
          allOrder,
          tasks,
          details,
          selectedList,
          hideCompleted: new Set([
            ...[...hideCompletedMap]
              .filter(([, hide]) => hide)
              .map(([name]) => name),
            ...(readHideCompletedAll() ? [ALL_LISTS] : []),
          ]),
        });
      } catch (err) {
        if (version !== refreshVersion.current) return;
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (version === refreshVersion.current)
          dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [showStatus, selectList],
  );

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), state.searchQuery ? 150 : 0);
    return () => clearTimeout(timer);
  }, [refresh, state.searchQuery]);

  // Listen for external database changes (file watcher)
  useEffect(() => {
    const unsubscribe = getHost().onDbChanged(() => {
      refresh();
    });
    return unsubscribe;
  }, [refresh]);

  // Refresh when popup is shown (pick up external changes) or hidden (re-sort ready for next open)
  useEffect(() => {
    const unsubShown = getHost().onPopupShown(() => {
      refresh();
    });
    const unsubHidden = getHost().onPopupHidden(() => {
      refresh();
    });
    return () => {
      unsubShown();
      unsubHidden();
    };
  }, [refresh]);

  // Task operations
  const addTask = useCallback(
    async (description: string, listName: string) => {
      try {
        const result = await taskService.addTask(description, listName);
        showStatus(`Added: ${result.task.id.slice(0, 3)}`);
        await refresh();
        return true;
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    [refresh, showStatus],
  );

  const toggleStatus = useCallback(
    async (taskId: string, currentStatus: TaskStatus) => {
      const newStatus =
        currentStatus === TS.Done || currentStatus === TS.WontDo
          ? TS.Pending
          : TS.Done;
      dispatch({ type: "UPDATE_TASK_STATUS", taskId, status: newStatus });
      try {
        await taskService.setTaskStatus(taskId, newStatus);
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const setStatusTo = useCallback(
    async (taskId: string, status: TaskStatus) => {
      dispatch({ type: "UPDATE_TASK_STATUS", taskId, status });
      try {
        await taskService.setTaskStatus(taskId, status);
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const rename = useCallback(
    async (taskId: string, newDescription: string) => {
      try {
        await taskService.renameTask(taskId, newDescription);
        await refresh();
        return true;
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    [refresh, showStatus],
  );

  const deleteTaskAction = useCallback(
    async (taskId: string, cascade?: boolean) => {
      try {
        await taskService.deleteTask(taskId, cascade);
        showStatus("Deleted");
        await refresh();
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [refresh, showStatus],
  );

  const moveTaskAction = useCallback(
    async (taskId: string, targetList: string) => {
      try {
        await taskService.moveTask(taskId, targetList);
        showStatus(`Moved to ${targetList}`);
        await refresh();
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [refresh, showStatus],
  );

  const reorderTaskAction = useCallback(
    async (
      taskId: string,
      newIndex: number,
      listName: string,
      oldIndex: number,
    ) => {
      dispatch({ type: "REORDER_TASKS", listName, oldIndex, newIndex });
      try {
        await taskService.reorderTask(taskId, newIndex);
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  // "All lists" has its own saved order; indexes are into the full All view.
  const reorderAllListsTaskAction = useCallback(
    async (taskId: string, newIndex: number) => {
      dispatch({ type: "REORDER_ALL", taskId, newIndex });
      try {
        await taskService.reorderAllListsTask(taskId, newIndex);
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  // List operations
  const createListAction = useCallback(
    async (name: string) => {
      try {
        await listService.createList(name);
        selectList(name);
        showStatus(`Created list "${name}"`);
        await refresh();
        return true;
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    [refresh, showStatus, selectList],
  );

  const deleteListAction = useCallback(
    async (name: string) => {
      try {
        await listService.deleteList(name);
        showStatus(`Deleted list "${name}"`);
        await refresh();
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [refresh, showStatus],
  );

  const renameListAction = useCallback(
    async (oldName: string, newName: string) => {
      try {
        await listService.renameList(oldName, newName);
        if (selectedListRef.current === oldName) selectList(newName);
        showStatus(`Renamed "${oldName}" to "${newName}"`);
        await refresh();
        return true;
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    [refresh, showStatus, selectList],
  );

  const reorderListAction = useCallback(
    async (name: string, newIndex: number, oldIndex: number) => {
      dispatch({ type: "REORDER_LISTS", oldIndex, newIndex });
      try {
        await listService.reorderList(name, newIndex);
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await refresh();
      }
    },
    [refresh, showStatus],
  );

  const toggleHideCompleted = useCallback(
    async (name: string) => {
      const hide = !state.hideCompletedLists.has(name);
      dispatch({ type: "SET_HIDE_COMPLETED", name, hide });
      if (name !== ALL_LISTS) {
        await listService.setListHideCompleted(name, hide);
        return;
      }
      try {
        localStorage.setItem(HIDE_COMPLETED_ALL_KEY, String(hide));
      } catch {
        /* The setting still applies for this session. */
      }
    },
    [state.hideCompletedLists],
  );

  // Undo/redo
  const undoAction = useCallback(async () => {
    try {
      const desc = await undoService.undo();
      if (desc) showStatus(`Undone: ${desc}`);
      else showStatus("Nothing to undo");
      await refresh();
    } catch (err) {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refresh, showStatus]);

  const redoAction = useCallback(async () => {
    try {
      const desc = await undoService.redo();
      if (desc) showStatus(`Redone: ${desc}`);
      else showStatus("Nothing to redo");
      await refresh();
    } catch (err) {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refresh, showStatus]);

  // Search
  const setSearch = useCallback((query: string) => {
    if (query === searchQueryRef.current) return;
    searchQueryRef.current = query;
    ++refreshVersion.current;
    dispatch({ type: "SET_SEARCH", query });
    try {
      if (query) localStorage.setItem("tasker:searchQuery", query);
      else localStorage.removeItem("tasker:searchQuery");
    } catch {
      /* Search still works for this session. */
    }
  }, []);

  // Apply system sort (one-shot)
  const applySystemSortAction = useCallback(async () => {
    try {
      // The All view sorts only its own order, never the lists'.
      if (selectedListRef.current === ALL_LISTS) {
        await taskService.applySystemSortAllLists();
        showStatus("Sorted All lists");
      } else {
        const count = await taskService.applySystemSort(selectedListRef.current);
        showStatus(`Sorted ${count} list${count !== 1 ? "s" : ""}`);
      }
      await refresh();
    } catch (err) {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refresh, showStatus]);

  // Bulk soft-delete by status
  const softDeleteByStatusAction = useCallback(
    async (status: TaskStatus, listName?: string) => {
      try {
        const count = await taskService.softDeleteByStatus(status, listName);
        showStatus(`Deleted ${count} task${count !== 1 ? "s" : ""}`);
        await refresh();
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [refresh, showStatus],
  );

  // Bulk soft-delete older than date
  const softDeleteOlderThanAction = useCallback(
    async (beforeDate: string, listName?: string) => {
      try {
        const count = await taskService.softDeleteOlderThan(
          beforeDate,
          listName,
        );
        showStatus(`Deleted ${count} task${count !== 1 ? "s" : ""}`);
        await refresh();
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [refresh, showStatus],
  );

  // A relationship can point outside the selected list or current search.
  const navigateToTask = useCallback(
    async (taskId: string) => {
      if (isEditing) {
        showStatus("Save or cancel your edit first");
        return;
      }
      try {
        const task = await taskService.getTaskById(taskId);
        if (!task || task.isTrashed) {
          showStatus(`Task ${taskId} not found`);
          return;
        }
        // The All view already shows every list, so stay there.
        const target =
          selectedListRef.current === ALL_LISTS ? ALL_LISTS : task.listName;
        const done = task.status === TS.Done || task.status === TS.WontDo;
        if (done && target === ALL_LISTS) {
          dispatch({ type: "SET_HIDE_COMPLETED", name: ALL_LISTS, hide: false });
          try {
            localStorage.setItem(HIDE_COMPLETED_ALL_KEY, "false");
          } catch {
            /* Storage may be unavailable. */
          }
        } else if (done) {
          await listService.setListHideCompleted(task.listName, false);
        }
        navigationTarget.current = task.id;
        selectList(target);
        setSearch("");
        await refresh({ searchQuery: "" });
      } catch (err) {
        showStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [refresh, selectList, setSearch, showStatus, isEditing],
  );

  useEffect(() => {
    const taskId = navigationTarget.current;
    if (!taskId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-task-id="${taskId}"]`,
    );
    if (!el) return;
    navigationTarget.current = null;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("task-highlight");
    void el.offsetWidth;
    el.classList.add("task-highlight");
  }, [state.tasks, state.selectedList, state.hideCompletedLists]);

  // Group tasks by list; the All view interleaves every list in its saved order.
  const allTasks = useMemo(() => {
    const byId = new Map(state.tasks.map((t) => [t.id, t]));
    const ordered = state.allOrder.flatMap((id) => byId.get(id) ?? []);
    const known = new Set(state.allOrder);
    // Tasks not in the saved order yet (e.g. just synced) go first, like new tasks.
    return [...state.tasks.filter((t) => !known.has(t.id)), ...ordered];
  }, [state.tasks, state.allOrder]);
  const tasksByList = state.lists.reduce<Record<string, Task[]>>(
    (acc, listName) => {
      acc[listName] = state.tasks.filter((t) => t.listName === listName);
      return acc;
    },
    { [ALL_LISTS]: allTasks },
  );

  // Stats
  const selectedTasks = tasksByList[state.selectedList] ?? [];
  const pendingCount = selectedTasks.filter((t) => t.status === 0).length;
  const inProgressCount = selectedTasks.filter((t) => t.status === 1).length;
  const totalCount = selectedTasks.length;

  return {
    ...state,
    tasksByList,
    relDetails: state.relDetails,
    pendingCount,
    inProgressCount,
    totalCount,
    refresh,
    addTask,
    toggleStatus,
    setStatusTo,
    rename,
    deleteTask: deleteTaskAction,
    moveTask: moveTaskAction,
    reorderTask: reorderTaskAction,
    reorderAllListsTask: reorderAllListsTaskAction,
    createList: createListAction,
    deleteList: deleteListAction,
    renameList: renameListAction,
    reorderList: reorderListAction,
    toggleHideCompleted,
    undo: undoAction,
    redo: redoAction,
    setSearch,
    selectList,
    isEditing,
    setIsEditing,
    applySystemSort: applySystemSortAction,
    navigateToTask,
    showStatus,
    softDeleteByStatus: softDeleteByStatusAction,
    softDeleteOlderThan: softDeleteOlderThanAction,
  };
}
