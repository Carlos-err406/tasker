import { createContext, useContext, useRef } from "react";
import type { Task, TaskStatus } from "@tasker/core/types";
import {
  ArrowUpRight,
  Ban,
  Copy,
  CornerLeftUp,
  CornerRightDown,
  Link2,
} from "lucide-react";
import type { RelEntry, TaskRelDetails } from "../hooks/use-tasker-store.js";
import { getHost } from "../host.js";
import { cn } from "../lib/utils.js";
import type { NavigateOptions } from "../lib/task-navigation.js";
import {
  getLinkedStatusColor,
  getLinkedStatusLabel,
} from "../lib/task-display.js";
import { buildTaskActions } from "./task-actions.js";
import { TaskMenuItems, type TaskMenuAction } from "./task-menu-actions.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu.js";

/** Every loaded task, so a row linking to another task can offer that task's actions. */
export const LinkedTasksContext = createContext<{
  tasks: ReadonlyMap<string, Task>;
  relDetails: Record<string, TaskRelDetails>;
} | null>(null);

export type RelationshipKind =
  | "parent"
  | "subtask"
  | "blocks"
  | "blockedBy"
  | "related";
const KINDS = {
  parent: {
    label: "Subtask of",
    icon: CornerLeftUp,
    color: "text-muted-foreground",
  },
  subtask: {
    label: "Subtask",
    icon: CornerRightDown,
    color: "text-muted-foreground",
  },
  blocks: { label: "Blocks", icon: Ban, color: "text-amber-400/80" },
  blockedBy: { label: "Blocked by", icon: Ban, color: "text-amber-400/80" },
  related: { label: "Related to", icon: Link2, color: "text-teal-400/80" },
} as const;

interface RelationshipLineProps {
  kind: RelationshipKind;
  entry: RelEntry;
  lists: string[];
  onNavigateToTask: (taskId: string, options?: NavigateOptions) => void;
  onShowStatus: (message: string) => void;
  onCreateSubtask: (taskId: string) => void;
  onMove: (taskId: string, targetList: string) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onRename: (taskId: string, newDescription: string) => unknown;
  onDelete: (taskId: string, cascade?: boolean) => void;
}

export function RelationshipLine(props: RelationshipLineProps) {
  const { kind, entry, onNavigateToTask } = props;
  const { label, icon: Icon, color } = KINDS[kind];
  const status = getLinkedStatusLabel(entry.status);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={getHost().touch}>
        <button
          data-task-link={entry.id}
          title={entry.id}
          onClick={() => onNavigateToTask(entry.id)}
          // The row's own menu is for the task that owns this line.
          onContextMenu={(e) => e.stopPropagation()}
          className={cn(
            "flex w-full items-start gap-1 font-mono text-[10px] mt-0.5 hover:text-foreground transition-colors text-left",
            color,
          )}
        >
          <Icon className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">
            {label} {entry.title}
          </span>
          {status && (
            <span
              className={cn(
                "flex-shrink-0",
                getLinkedStatusColor(entry.status),
              )}
            >
              {status}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <LinkedTaskMenuContent {...props} />
    </ContextMenu>
  );
}

function LinkedTaskMenuContent({
  entry,
  lists,
  onNavigateToTask,
  onShowStatus,
  onCreateSubtask,
  onMove,
  onSetStatus,
  onRename,
  onDelete,
}: RelationshipLineProps) {
  const linked = useContext(LinkedTasksContext);
  const task = linked?.tasks.get(entry.id);
  // Act once the menu has closed, so an editor or moved row isn't fighting its focus restore.
  const pending = useRef<(() => void) | null>(null);
  const deferred = (action: TaskMenuAction): TaskMenuAction => ({
    ...action,
    onSelect: action.onSelect && (() => (pending.current = action.onSelect!)),
    children: action.children?.map(deferred),
  });
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(entry.id);
      onShowStatus(`Copied: ${entry.id}`);
    } catch {
      onShowStatus("Could not copy task ID");
    }
  };
  const goTo: TaskMenuAction = {
    label: "Go to task",
    icon: <ArrowUpRight />,
    onSelect: () => onNavigateToTask(entry.id),
  };
  // A linked task outside the loaded tasks (e.g. hidden by search) can still be reached.
  const actions = task
    ? buildTaskActions(
        task,
        lists,
        !!linked?.relDetails[task.id]?.subtasks.length,
        {
          onEdit: () => onNavigateToTask(task.id, { edit: true }),
          onCopyId: copyId,
          onCopyText: () => {
            void navigator.clipboard.writeText(task.description);
            onShowStatus("Copied task text");
          },
          onCreateSubtask,
          onMove,
          onSetStatus,
          onRename,
          onDelete,
        },
      )
    : [{ label: "Copy ID", icon: <Copy />, onSelect: copyId }];
  return (
    <ContextMenuContent
      collisionPadding={8}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        const run = pending.current;
        pending.current = null;
        run?.();
      }}
    >
      <TaskMenuItems actions={[goTo, ...actions].map(deferred)} />
    </ContextMenuContent>
  );
}
