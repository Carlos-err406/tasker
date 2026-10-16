import type { Task, TaskStatus } from "@tasker/core/types";
import { TaskStatus as TS } from "@tasker/core/types";
import {
  Circle,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Copy,
  CornerRightDown,
  FolderInput,
  Pencil,
  Trash2,
} from "lucide-react";
import type { TaskMenuAction } from "./task-menu-actions.js";

export interface TaskActionHandlers {
  onEdit: () => void;
  onCopyId: () => void;
  onCopyText: () => void;
  onCreateSubtask: (taskId: string) => void;
  onMove: (taskId: string, targetList: string) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string, cascade?: boolean) => void;
}

/** The actions every task offers, shared by its own menu and menus of rows that link to it. */
export function buildTaskActions(
  task: Task,
  lists: string[],
  hasSubtasks: boolean,
  handlers: TaskActionHandlers,
): TaskMenuAction[] {
  return [
    {
      label: "Edit",
      icon: <Pencil />,
      onSelect: handlers.onEdit,
      deferUntilClosed: true,
    },
    { label: "Copy ID", icon: <Copy />, onSelect: handlers.onCopyId },
    { label: "Copy text", icon: <Copy />, onSelect: handlers.onCopyText },
    {
      label: "Create subtask",
      icon: <CornerRightDown />,
      onSelect: () => handlers.onCreateSubtask(task.id),
      deferUntilClosed: true,
    },
    {
      label: "Move to...",
      icon: <FolderInput />,
      disabled: !lists.some((name) => name !== task.listName),
      children: lists
        .filter((name) => name !== task.listName)
        .map((name) => ({
          label: name,
          onSelect: () => handlers.onMove(task.id, name),
          deferUntilClosed: true,
        })),
    },
    {
      label: "Set Status",
      icon: <CircleDot />,
      children: [
        {
          label: "Pending",
          status: TS.Pending,
          icon: <Circle className="text-muted-foreground" />,
        },
        {
          label: "In Progress",
          status: TS.InProgress,
          icon: <CircleDot className="text-amber-400" />,
        },
        {
          label: "Done",
          status: TS.Done,
          icon: <CircleCheck className="text-green-400" />,
        },
        {
          label: "Won't Do",
          status: TS.WontDo,
          icon: <CircleSlash className="text-zinc-400" />,
        },
      ].map(({ label, status, icon }) => ({
        label,
        icon,
        selected: task.status === status,
        onSelect: () => handlers.onSetStatus(task.id, status),
        deferUntilClosed: true,
      })),
    },
    hasSubtasks
      ? {
          label: "Delete...",
          icon: <Trash2 />,
          destructive: true,
          children: [
            {
              label: "This task only",
              destructive: true,
              onSelect: () => handlers.onDelete(task.id, false),
              deferUntilClosed: true,
            },
            {
              label: "Task and subtasks",
              destructive: true,
              onSelect: () => handlers.onDelete(task.id, true),
              deferUntilClosed: true,
            },
          ],
        }
      : {
          label: "Delete",
          icon: <Trash2 />,
          destructive: true,
          onSelect: () => handlers.onDelete(task.id),
          deferUntilClosed: true,
        },
  ];
}
