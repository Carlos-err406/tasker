import { TaskMenuItems } from "./task-menu-actions.js";
import { TouchTaskActions } from "./TouchTaskActions.js";
import { TouchEditorScreen } from "./TouchEditorScreen.js";
import { TouchEditorActions } from "./TouchEditorActions.js";
import { Button } from "./ui/button.js";
import { getHost } from "../host.js";
import {
  memo,
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
} from "react";
import type { Task, TaskStatus } from "@tasker/core/types";
import { TaskStatus as TS, Priority } from "@tasker/core/types";
import type { RelEntry, TaskRelDetails } from "../hooks/use-tasker-store.js";
import { buildTaskActions } from "./task-actions.js";
import { RelationshipLine, type RelationshipKind } from "./RelationshipLine.js";
import { EDIT_TASK_EVENT, type NavigateOptions } from "../lib/task-navigation.js";
import { cn } from "../lib/utils.js";
import { useMetadataAutocomplete } from "../hooks/use-metadata-autocomplete.js";
import { useMarkdownShortcuts } from "../hooks/use-markdown-shortcuts.js";
import { AutocompleteDropdown } from "./AutocompleteDropdown.js";
import {
  Check,
  Minus,
  X,
  Calendar,
  Repeat,
  Tag,
  List as ListIcon,
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  Copy,
  Hash,
} from "lucide-react";
import { TaskContextMenu, TaskContextMenuContent } from "./TaskContextMenu.js";
import { MarkdownContent } from "./MarkdownContent.js";
import {
  getPlainText,
  getSelectionOffsets,
  setCaretOffset,
  setPlainText,
} from "../lib/content-editable-utils.js";
import { ContextMenuTrigger } from "./ui/context-menu.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip.js";
import {
  getDisplayTitle,
  getDescriptionPreview,
  getShortId,
  isDone,
  isInProgress,
  isWontDo,
  getPriorityColor,
  getDueDateColor,
  formatDueDate,
  getSchedule,
  getTagColor,
} from "../lib/task-display.js";

interface TaskItemProps {
  task: Task;
  lists: string[];
  relDetails?: TaskRelDetails;
  onToggleStatus: (taskId: string, currentStatus: TaskStatus) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onRename: (taskId: string, newDescription: string) => Promise<boolean>;
  onDelete: (taskId: string, cascade?: boolean) => void;
  onMove: (taskId: string, targetList: string) => void;
  onShowStatus: (message: string) => void;
  onNavigateToTask: (taskId: string, options?: NavigateOptions) => void;
  onCreateSubtask: (taskId: string) => void;
  onTagClick?: (tag: string) => void;
  onEditingChange?: (taskId: string, editing: boolean) => void;
  showMediaPreviews?: boolean;
  mediaPreviewResetSignal?: number;
  /** Show which list the task belongs to (only in the All view). */
  showListName?: boolean;
  /** Clicking the list label opens that list. */
  onSelectList?: (listName: string) => void;
}

export const TaskItem = memo(function TaskItem({
  task,
  lists,
  relDetails,
  onToggleStatus,
  onSetStatus,
  onRename,
  onDelete,
  onMove,
  onShowStatus,
  onNavigateToTask,
  onCreateSubtask,
  onTagClick,
  onEditingChange,
  showMediaPreviews = true,
  mediaPreviewResetSignal = 0,
  showListName = false,
  onSelectList,
}: TaskItemProps) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onEditingChange?.(task.id, editing);
    return () => onEditingChange?.(task.id, false);
  }, [task.id, editing, onEditingChange]);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLDivElement>(null);

  const ac = useMetadataAutocomplete(editValue, inputRef, task.id);
  const md = useMarkdownShortcuts(inputRef, setEditValue);

  const done = isDone(task);
  const inProg = isInProgress(task);
  const wontDo = isWontDo(task);
  const title = getDisplayTitle(task);
  const descPreview = getDescriptionPreview(task);
  const shortId = getShortId(task);
  const priorityColor = getPriorityColor(task.priority);
  const dueDateLabel = formatDueDate(task.dueDate);
  const dueDateColor = getDueDateColor(task.dueDate);
  const schedule = getSchedule(task);

  const handleToggleCheckbox = useCallback(
    (contentLineNumber: number) => {
      // descPreview (content) corresponds to lines after the title in task.description,
      // offset by any leading blank lines that getDescriptionPreview trims.
      const descLines = task.description.split("\n");
      let bodyStart = 1; // skip title (line 0)
      while (
        bodyStart < descLines.length &&
        descLines[bodyStart]!.trim() === ""
      )
        bodyStart++;

      const targetLine = bodyStart + contentLineNumber;
      if (targetLine >= descLines.length) return;

      // Toggle the first checkbox pattern on this line
      descLines[targetLine] = descLines[targetLine]!.replace(
        /\[[ xX]\]/,
        (match) => (match === "[ ]" ? "[x]" : "[ ]"),
      );

      const newDescription = descLines.join("\n");
      if (newDescription !== task.description) {
        onRename(task.id, newDescription);
      }
    },
    [task.description, task.id, onRename],
  );

  const editAfterMenuClose = useRef(false);
  const initialEditText = useRef("");
  const startEdit = () => {
    // Wait until the menu releases its focus scope before mounting the editor.
    editAfterMenuClose.current = true;
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!editing || !el) return;
    // Populate before paint so an empty editor cannot collapse a scrolled row.
    setPlainText(el, initialEditText.current);
    el.focus({ preventScroll: true });
    setCaretOffset(el, initialEditText.current.length);
  }, [editing]);

  const savingRef = useRef(false);
  const submitEdit = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const trimmed = editValue.trim();
      if (trimmed && trimmed !== task.description) {
        if (!(await onRename(task.id, trimmed))) return;
      }
      setEditing(false);
    } finally {
      savingRef.current = false;
    }
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const hasImage =
        Array.from(e.clipboardData.types).includes("image/png") ||
        Array.from(e.clipboardData.types).includes("image/jpeg") ||
        Array.from(e.clipboardData.files).some((f) =>
          f.type.startsWith("image/"),
        );

      if (!hasImage) return; // Allow normal text paste

      e.preventDefault();

      const file = Array.from(e.clipboardData.files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (!file) return;
      let savedPath: string;
      try {
        savedPath = await getHost().saveImage(file);
      } catch (error) {
        onShowStatus(String(error));
        return;
      }
      if (!savedPath) return;

      const el = inputRef.current;
      if (!el) return;

      const { start, end } = getSelectionOffsets(el);
      const currentValue = getPlainText(el);
      const before = currentValue.slice(0, start);
      const after = currentValue.slice(end);
      const insertion = `![image](${savedPath})`;
      const newValue = before + insertion + after;
      setPlainText(el, newValue);
      setEditValue(newValue);

      // Place cursor after the inserted markdown
      requestAnimationFrame(() => {
        setCaretOffset(el, before.length + insertion.length);
      });
    },
    [setEditValue],
  );

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Stop propagation so dnd-kit keyboard listeners don't intercept (e.g. Space)
    e.stopPropagation();
    // 1. Metadata autocomplete takes priority
    if (ac.onKeyDown(e)) {
      if ((e.key === "Enter" || e.key === "Tab") && ac.isOpen) {
        const newVal = ac.select(ac.selectedIndex);
        if (newVal !== null) {
          setEditValue(newVal);
          if (inputRef.current) setPlainText(inputRef.current, newVal);
        }
      }
      return;
    }
    // 2. Markdown shortcuts (Cmd+B, Cmd+I, etc. and Tab for template tab-stops)
    if (md.onKeyDown(e)) return;
    // 3. Escape closes editor
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      return;
    }
    // 4. Submit
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitEdit();
    }
  };

  const handleCheckboxClick = () => {
    onToggleStatus(task.id, task.status);
  };

  const handleCheckboxContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onSetStatus(task.id, inProg ? TS.Pending : TS.InProgress);
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(shortId);
      onShowStatus(`Copied: ${shortId}`);
    } catch {
      onShowStatus("Could not copy task ID");
    }
  };

  const copyText = () => {
    navigator.clipboard.writeText(task.description);
    onShowStatus("Copied task text");
  };

  // A menu on another task's relationship line asked to edit this task.
  useEffect(() => {
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== task.id || editing) return;
      initialEditText.current = task.description;
      setEditValue(task.description);
      setEditing(true);
    };
    window.addEventListener(EDIT_TASK_EVENT, open);
    return () => window.removeEventListener(EDIT_TASK_EVENT, open);
  }, [task.id, task.description, editing]);

  const finishMenuClose = () => {
    if (!editAfterMenuClose.current) return;
    editAfterMenuClose.current = false;
    initialEditText.current = task.description;
    setEditValue(task.description);
    setEditing(true);
  };
  const actions = buildTaskActions(task, lists, !!relDetails?.subtasks.length, {
    onEdit: startEdit,
    onCopyId: copyId,
    onCopyText: copyText,
    onCreateSubtask,
    onMove,
    onSetStatus,
    onDelete,
  });

  return (
    <TouchTaskActions
      title={title}
      shortId={shortId}
      actions={actions}
      onClosed={finishMenuClose}
    >
      <TaskContextMenu
        items={<TaskMenuItems actions={actions} />}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          finishMenuClose();
        }}
      >
        <ContextMenuTrigger asChild disabled={getHost().touch}>
          <div
            data-testid={`task-item-${shortId}`}
            className={cn(
              "group flex items-start gap-2 px-3 py-2 transition-colors hover:bg-accent/50",
            )}
          >
            {/* Checkbox column */}
            <div
              className={cn(
                "flex flex-col items-center mt-0.5",
                (done || wontDo) && "opacity-60",
              )}
            >
              <button
                data-testid={`task-checkbox-${shortId}`}
                aria-label={`Change status of ${title}`}
                onClick={handleCheckboxClick}
                onContextMenu={handleCheckboxContextMenu}
                className={cn(
                  "h-4 w-4 rounded border transition-colors flex items-center justify-center",
                  done
                    ? "border-green-500 bg-green-500/20 text-green-400"
                    : wontDo
                      ? "border-zinc-500 bg-zinc-500/20 text-zinc-400"
                      : inProg
                        ? "border-amber-400 bg-amber-400/20 text-amber-400"
                        : "border-muted-foreground/40 hover:border-foreground/60",
                )}
              >
                {done && <Check className="h-3 w-3" />}
                {wontDo && <X className="h-3 w-3" />}
                {inProg && <Minus className="h-3 w-3" />}
              </button>
            </div>

            {/* Content column */}
            <div className="flex-1 min-w-0 select-text">
              {editing ? (
                <TouchEditorScreen
                  title="Edit task"
                  listName={task.listName}
                  onCancel={() => setEditing(false)}
                >
                  <div
                    key="editing"
                    ref={inputRef}
                    contentEditable
                    autoCorrect="off"
                    autoCapitalize="off"
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline="true"
                    data-testid="task-edit-input"
                    onInput={(e) => {
                      const plain = getPlainText(e.currentTarget);
                      setEditValue(plain);
                      ac.detect();
                    }}
                    onKeyDown={handleEditKeyDown}
                    onPaste={handlePaste}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={() => {
                      if (!getHost().touch && !ac.isOpen) submitEdit();
                    }}
                    className="min-h-[28px] max-h-[300px] overflow-y-auto overflow-x-hidden break-words [&_*]:max-w-full [&_*]:!whitespace-pre-wrap w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <TouchEditorActions
                    editor={inputRef}
                    onChange={setEditValue}
                    onSave={submitEdit}
                    onCancel={() => setEditing(false)}
                    onError={onShowStatus}
                  />
                  {ac.isOpen && (
                    <AutocompleteDropdown
                      anchorRef={inputRef}
                      suggestions={ac.suggestions}
                      selectedIndex={ac.selectedIndex}
                      calendarDate={ac.calendarDate}
                      onSelect={(i) => {
                        const newVal = ac.select(i);
                        if (newVal !== null) {
                          setEditValue(newVal);
                          if (inputRef.current)
                            setPlainText(inputRef.current, newVal);
                        }
                      }}
                    />
                  )}
                </TouchEditorScreen>
              ) : (
                <div
                  key="display"
                  className={cn((done || wontDo) && "opacity-60")}
                >
                  <div className="flex items-start gap-1.5">
                    {task.priority !== null && task.priority !== undefined && (
                      <span
                        className={cn("mt-0.5 flex-shrink-0", priorityColor)}
                      >
                        {task.priority === Priority.High && (
                          <ChevronsUp className="h-3.5 w-3.5" />
                        )}
                        {task.priority === Priority.Medium && (
                          <ChevronUp className="h-3.5 w-3.5" />
                        )}
                        {task.priority === Priority.Low && (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                    )}
                    <span
                      data-testid={`task-name-${shortId}`}
                      className={cn(
                        "text-sm leading-tight",
                        done && "line-through text-muted-foreground",
                        wontDo && "line-through text-muted-foreground",
                      )}
                    >
                      {title}
                    </span>
                  </div>

                  {/* Description preview */}
                  {descPreview && (
                    <MarkdownContent
                      content={descPreview}
                      onToggleCheckbox={handleToggleCheckbox}
                      showMediaPreviews={showMediaPreviews}
                      mediaPreviewScope={task.id}
                      mediaPreviewResetSignal={mediaPreviewResetSignal}
                    />
                  )}

                  {/* Relationship lines */}
                  {(
                    [
                      ...(relDetails?.parent ? [["parent", relDetails.parent] as const] : []),
                      ...(relDetails?.subtasks ?? []).map((e) => ["subtask", e] as const),
                      ...(relDetails?.blocks ?? []).map((e) => ["blocks", e] as const),
                      ...(relDetails?.blockedBy ?? []).map((e) => ["blockedBy", e] as const),
                      ...(relDetails?.related ?? []).map((e) => ["related", e] as const),
                    ] satisfies (readonly [RelationshipKind, RelEntry])[]
                  ).map(([kind, entry]) => (
                    <RelationshipLine
                      key={`${kind}:${entry.id}`}
                      kind={kind}
                      entry={entry}
                      lists={lists}
                      onNavigateToTask={onNavigateToTask}
                      onShowStatus={onShowStatus}
                      onCreateSubtask={onCreateSubtask}
                      onMove={onMove}
                      onSetStatus={onSetStatus}
                      onDelete={onDelete}
                    />
                  ))}

                  {/* Due date */}
                  {dueDateLabel && (
                    <div
                      className={cn(
                        "flex items-center gap-1 font-mono text-[10px] mt-0.5",
                        dueDateColor,
                      )}
                    >
                      <Calendar className="h-3 w-3 flex-shrink-0" />
                      {dueDateLabel.charAt(0).toUpperCase() +
                        dueDateLabel.slice(1)}
                      {schedule.time && ` ${schedule.time}`}
                      {schedule.repeat && (
                        <Repeat
                          className="h-3 w-3 flex-shrink-0"
                          data-testid={`task-repeat-${task.id}`}
                          aria-label={`Repeats ${schedule.repeat}`}
                        >
                          <title>{`Repeats ${schedule.repeat}`}</title>
                        </Repeat>
                      )}
                    </div>
                  )}

                  {/* ID, list (All view) and tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            data-task-id-copy
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyId();
                            }}
                            className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0 font-mono text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                          >
                            <Hash className="h-2.5 w-2.5 flex-shrink-0" />
                            {shortId}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="task-id-tooltip pointer-events-none">
                          Copy ID
                        </TooltipContent>
                      </Tooltip>
                      {showListName && (
                        <button
                          type="button"
                          data-task-list
                          title={`Open ${task.listName}`}
                          aria-label={`Open list ${task.listName}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectList?.(task.listName);
                          }}
                          className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border px-1.5 py-0 text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                        >
                          <ListIcon className="h-2.5 w-2.5 flex-shrink-0" />
                          <span className="truncate">{task.listName}</span>
                        </button>
                      )}
                      {(task.tags ?? []).map((tag) => (
                        <button
                          key={tag}
                          data-task-tag
                          onClick={(e) => {
                            e.stopPropagation();
                            onTagClick?.(tag);
                          }}
                          className={cn(
                            "inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0 rounded-full hover:brightness-125 transition-all",
                            getTagColor(tag),
                          )}
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {tag}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </ContextMenuTrigger>

        <TaskContextMenuContent />
      </TaskContextMenu>
    </TouchTaskActions>
  );
});
