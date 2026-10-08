import {
  getAllTasks,
  getTaskById,
  searchTasks,
  addTask,
  setStatus,
  renameTask,
  deleteTask,
  moveTask,
  reorderTask,
  setTaskDueDate,
  setTaskPriority,
  restoreFromTrash,
  getStats,
  getRelationshipCounts,
  getTaskTitles,
  applySystemSort,
  softDeleteByStatus,
  softDeleteOlderThan,
  getTrash,
  clearTrash,
  getSubtasks,
  unsetParent,
} from "../../queries/index.js";
import type { TaskStatus, Priority } from "../../types/index.js";
import $try from "../try.js";
import type { IPCRegisterFunction } from "../registry.js";
import {
  TASKS_GET_ALL,
  TASKS_GET_BY_ID,
  TASKS_SEARCH,
  TASKS_ADD,
  TASKS_SET_STATUS,
  TASKS_RENAME,
  TASKS_DELETE,
  TASKS_MOVE,
  TASKS_REORDER,
  TASKS_SET_DUE_DATE,
  TASKS_SET_PRIORITY,
  TASKS_GET_STATS,
  TASKS_RESTORE,
  TASKS_GET_REL_COUNTS,
  TASKS_GET_TITLES,
  TASKS_APPLY_SYSTEM_SORT,
  TASKS_SOFT_DELETE_BY_STATUS,
  TASKS_SOFT_DELETE_OLDER_THAN,
  TASKS_GET_TRASH,
  TASKS_CLEAR_TRASH,
} from "./tasks-channels.js";

export const tasksRegister: IPCRegisterFunction = (
  ipcMain,
  _widget,
  { db, undo },
) => {
  ipcMain.handle(TASKS_GET_ALL, (_, listName?: string) => {
    return $try(() => getAllTasks(db, listName));
  });

  ipcMain.handle(TASKS_GET_BY_ID, (_, taskId: string) => {
    return $try(() => getTaskById(db, taskId));
  });

  ipcMain.handle(TASKS_SEARCH, (_, query: string) => {
    return $try(() => searchTasks(db, query));
  });

  ipcMain.handle(TASKS_ADD, (_, description: string, listName: string) => {
    return $try(() => {
      const result = addTask(db, description, listName);
      undo.recordCommand({
        $type: "add",
        task: result.task,
        executedAt: new Date().toISOString(),
      });
      undo.saveHistory();
      return result;
    });
  });

  ipcMain.handle(TASKS_SET_STATUS, (_, taskId: string, status: TaskStatus) => {
    return $try(() => {
      const task = getTaskById(db, taskId);
      if (!task) return { type: "not-found" as const, taskId };
      const oldStatus = task.status;
      const result = setStatus(db, taskId, status);
      if (result.type === "success") {
        undo.recordCommand({
          $type: "set-status",
          taskId,
          oldStatus,
          newStatus: status,
          executedAt: new Date().toISOString(),
        });
        undo.saveHistory();
      }
      return result;
    });
  });

  ipcMain.handle(TASKS_RENAME, (_, taskId: string, newDescription: string) => {
    return $try(() => {
      const task = getTaskById(db, taskId);
      if (!task) return { type: "not-found" as const, taskId };
      const oldDescription = task.description;
      const result = renameTask(db, taskId, newDescription);
      if (result.type === "success") {
        undo.recordCommand({
          $type: "rename",
          taskId,
          oldDescription,
          newDescription,
          executedAt: new Date().toISOString(),
        });
        undo.saveHistory();
      }
      return result;
    });
  });

  ipcMain.handle(TASKS_DELETE, (_, taskId: string, cascade = true) => {
    return $try(() => {
      const task = getTaskById(db, taskId);
      if (!task) return { type: "not-found" as const, taskId };

      if (!cascade) {
        // Unparent direct children first, then delete just this task (no descendants)
        const children = getSubtasks(db, taskId);
        for (const child of children) {
          unsetParent(db, child.id);
        }
        const result = deleteTask(db, taskId);
        if (result.type === "success") {
          // Record as batch: set-parent undos (to restore parentage) + the delete
          const commands: any[] = children.map((child) => ({
            $type: "set-parent" as const,
            taskId: child.id,
            oldParentId: taskId,
            newParentId: null as string | null,
            executedAt: new Date().toISOString(),
          }));
          commands.push({
            $type: "delete",
            deletedTask: task,
            executedAt: new Date().toISOString(),
          });
          undo.recordCommand({
            $type: "batch",
            batchDescription: `Delete task only: ${taskId}`,
            commands,
            executedAt: new Date().toISOString(),
          });
          undo.saveHistory();
        }
        return result;
      }

      const result = deleteTask(db, taskId);
      if (result.type === "success") {
        undo.recordCommand({
          $type: "delete",
          deletedTask: task,
          executedAt: new Date().toISOString(),
        });
        undo.saveHistory();
      }
      return result;
    });
  });

  ipcMain.handle(TASKS_MOVE, (_, taskId: string, targetList: string) => {
    return $try(() => {
      const task = getTaskById(db, taskId);
      if (!task) return { type: "not-found" as const, taskId };
      const sourceList = task.listName;
      const result = moveTask(db, taskId, targetList);
      if (result.type === "success") {
        undo.recordCommand({
          $type: "move",
          taskId,
          sourceList,
          targetList,
          executedAt: new Date().toISOString(),
        });
        undo.saveHistory();
      }
      return result;
    });
  });

  ipcMain.handle(TASKS_REORDER, (_, taskId: string, newIndex: number) => {
    return $try(() => {
      const task = getTaskById(db, taskId);
      if (!task) return;
      // Compute display index (position in sort_order DESC list), not raw sortOrder
      const listTasks = getAllTasks(db, task.listName);
      const oldIndex = listTasks.findIndex((t) => t.id === taskId);
      reorderTask(db, taskId, newIndex);
      undo.recordCommand({
        $type: "reorderTask",
        taskId,
        listName: task.listName,
        oldIndex,
        newIndex,
        executedAt: new Date().toISOString(),
      });
      undo.saveHistory();
    });
  });

  ipcMain.handle(
    TASKS_SET_DUE_DATE,
    (_, taskId: string, dueDate: string | null) => {
      return $try(() => {
        const task = getTaskById(db, taskId);
        if (!task) return { type: "not-found" as const, taskId };
        const oldDueDate = task.dueDate;
        const result = setTaskDueDate(db, taskId, dueDate);
        if (result.type === "success") {
          undo.recordCommand({
            $type: "metadata",
            taskId,
            oldDueDate,
            newDueDate: dueDate,
            oldPriority: task.priority,
            newPriority: task.priority,
            executedAt: new Date().toISOString(),
          });
          undo.saveHistory();
        }
        return result;
      });
    },
  );

  ipcMain.handle(
    TASKS_SET_PRIORITY,
    (_, taskId: string, priority: Priority | null) => {
      return $try(() => {
        const task = getTaskById(db, taskId);
        if (!task) return { type: "not-found" as const, taskId };
        const oldPriority = task.priority;
        const result = setTaskPriority(db, taskId, priority);
        if (result.type === "success") {
          undo.recordCommand({
            $type: "metadata",
            taskId,
            oldDueDate: task.dueDate,
            newDueDate: task.dueDate,
            oldPriority,
            newPriority: priority,
            executedAt: new Date().toISOString(),
          });
          undo.saveHistory();
        }
        return result;
      });
    },
  );

  ipcMain.handle(TASKS_GET_STATS, (_, listName?: string) => {
    return $try(() => getStats(db, listName));
  });

  ipcMain.handle(TASKS_RESTORE, (_, taskId: string) => {
    return $try(() => restoreFromTrash(db, taskId));
  });

  ipcMain.handle(TASKS_GET_REL_COUNTS, (_, taskIds: string[]) => {
    return $try(() => getRelationshipCounts(db, taskIds));
  });

  ipcMain.handle(TASKS_GET_TITLES, (_, taskIds: string[]) => {
    return $try(() => getTaskTitles(db, taskIds));
  });

  ipcMain.handle(TASKS_APPLY_SYSTEM_SORT, (_, listName?: string) => {
    return $try(() => applySystemSort(db, listName));
  });

  ipcMain.handle(
    TASKS_SOFT_DELETE_BY_STATUS,
    (_, status: TaskStatus, listName?: string) => {
      return $try(() => softDeleteByStatus(db, status, listName));
    },
  );

  ipcMain.handle(
    TASKS_SOFT_DELETE_OLDER_THAN,
    (_, beforeDate: string, listName?: string) => {
      return $try(() => softDeleteOlderThan(db, beforeDate, listName));
    },
  );

  ipcMain.handle(TASKS_GET_TRASH, (_, listName?: string) => {
    return $try(() => getTrash(db, listName));
  });

  ipcMain.handle(TASKS_CLEAR_TRASH, (_, listName?: string) => {
    return $try(() => clearTrash(db, listName));
  });

};
