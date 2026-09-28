import {
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { Task, TaskStatus } from "@tasker/core/types";
import type { TaskRelDetails } from "../hooks/use-tasker-store.js";
import { useMetadataAutocomplete } from "../hooks/use-metadata-autocomplete.js";
import { AutocompleteDropdown } from "./AutocompleteDropdown.js";
import {
  getPlainText,
  setCaretOffset,
  setPlainText,
} from "../lib/content-editable-utils.js";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ChevronDown,
  Plus,
  Ellipsis,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu.js";
import { getHost } from "../host.js";
import { getSelectionOffsets } from "../lib/content-editable-utils.js";
import { Input } from "./ui/input.js";
import { SortableTaskItem } from "./SortableTaskItem.js";

interface ListSectionProps {
  listName: string;
  tasks: Task[];
  lists: string[];
  dragHandleListeners?: React.HTMLAttributes<HTMLElement>;
  dragHandleAttributes?: React.HTMLAttributes<HTMLElement>;
  relDetails: Record<string, TaskRelDetails>;
  isDefault: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAddTask: (description: string, listName: string) => Promise<boolean>;
  onToggleStatus: (taskId: string, currentStatus: TaskStatus) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onRename: (taskId: string, newDescription: string) => Promise<boolean>;
  onDelete: (taskId: string, cascade?: boolean) => void;
  onMove: (taskId: string, targetList: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onShowStatus: (message: string) => void;
  onNavigateToTask: (taskId: string) => void;
  onTagClick?: (tag: string) => void;
  showMediaPreviews?: boolean;
  mediaPreviewResetSignal?: number;
  hideCompleted: boolean;
  onToggleHideCompleted: () => void;
}

export interface ListSectionHandle {
  startAdding: (initialValue?: string) => void;
}

export const ListSection = forwardRef<ListSectionHandle, ListSectionProps>(
  function ListSection(
    {
      listName,
      tasks,
      lists,
      relDetails,
      isDefault,
      collapsed,
      onToggleCollapsed,
      onAddTask,
      onToggleStatus,
      onSetStatus,
      onRename,
      onDelete,
      onMove,
      onRenameList,
      onDeleteList,
      onShowStatus,
      onNavigateToTask,
      onTagClick,
      showMediaPreviews = true,
      mediaPreviewResetSignal = 0,
      hideCompleted,
      onToggleHideCompleted,
      dragHandleListeners,
      dragHandleAttributes,
    },
    ref,
  ) {
    const [adding, setAdding] = useState(false);
    const [addValue, setAddValue] = useState("");
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState("");
    const addInputRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const focusNameInputRef = useRef(false);
    const preventMenuAutoFocusRef = useRef(false);

    const ac = useMetadataAutocomplete(addValue, addInputRef);

    const visibleTasks = useMemo(
      () =>
        hideCompleted
          ? tasks.filter((t) => t.status !== 2 && t.status !== 3)
          : tasks,
      [tasks, hideCompleted],
    );

    const taskIds = useMemo(
      () => visibleTasks.map((t) => t.id),
      [visibleTasks],
    );

    const pendingCount = tasks.filter((t) => t.status === 0).length;
    const doneCount = tasks.filter(
      (t) => t.status === 2 || t.status === 3,
    ).length;
    const totalCount = tasks.length;
    const hiddenDoneCount = hideCompleted ? doneCount : 0;
    const summaryParts: string[] = [];
    summaryParts.push(`${totalCount} task${totalCount !== 1 ? "s" : ""}`);
    if (pendingCount < totalCount) summaryParts.push(`${pendingCount} pending`);
    if (hiddenDoneCount > 0) summaryParts.push(`+${hiddenDoneCount} done`);
    const summary = summaryParts.join(", ");

    const startAdd = useCallback(
      (initialValue?: string) => {
        setAdding(true);
        setAddValue(initialValue ?? "");
        // Expand if collapsed
        if (collapsed) onToggleCollapsed();
        // Delay focus to let Radix ContextMenu finish closing and restoring focus.
        // Without this, the blur handler fires before the input is focused and
        // auto-submits the pre-filled metadata (e.g. subtask parent link).
        setTimeout(() => {
          const el = addInputRef.current;
          if (el) {
            // Only set textContent for pre-filled values (e.g. subtask parent link).
            // For empty inputs the div is already empty — setting textContent here
            // would wipe any text already typed by a fast E2E helper or user.
            if (initialValue !== undefined) {
              el.textContent = initialValue;
              setCaretOffset(el, 0);
            }
            el.focus();
          }
        }, 50);
      },
      [collapsed, onToggleCollapsed],
    );

    useImperativeHandle(ref, () => ({ startAdding: startAdd }), [startAdd]);

    const handleCreateSubtask = useCallback(
      (taskId: string) => {
        startAdd(`\n^${taskId}`);
      },
      [startAdd],
    );

    const savingRef = useRef(false);
    const submitAdd = async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        const trimmed = addValue.trim();
        if (trimmed) {
          if (!(await onAddTask(trimmed, listName))) return;
        }
        setAdding(false);
        setAddValue("");
      } finally {
        savingRef.current = false;
      }
    };

    const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
      const file = Array.from(event.clipboardData.files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (!file) return;
      event.preventDefault();
      const el = addInputRef.current;
      if (!el) return;
      try {
        const reference = await getHost().saveImage(file);
        if (!el.isConnected) return;
        const { start, end } = getSelectionOffsets(el),
          text = getPlainText(el);
        const insertion = `![image](${reference})`,
          value = text.slice(0, start) + insertion + text.slice(end);
        setPlainText(el, value);
        setAddValue(value);
        el.focus();
        setCaretOffset(el, start + insertion.length);
      } catch (error) {
        onShowStatus(String(error));
      }
    };

    const handleAddKeyDown = (e: React.KeyboardEvent) => {
      // Stop propagation so dnd-kit keyboard listeners don't intercept (e.g. Space)
      e.stopPropagation();
      // 1. Metadata autocomplete takes priority
      if (ac.onKeyDown(e)) {
        if ((e.key === "Enter" || e.key === "Tab") && ac.isOpen) {
          const newVal = ac.select(ac.selectedIndex);
          if (newVal !== null) {
            setAddValue(newVal);
            // Sync DOM so setCaretOffset (called in ac.select's setTimeout) works correctly
            if (addInputRef.current) setPlainText(addInputRef.current, newVal);
          }
        }
        return;
      }
      // 2. Escape closes input
      if (e.key === "Escape") {
        e.preventDefault();
        setAdding(false);
        return;
      }
      // 3. Submit
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitAdd();
      }
    };

    const startEditName = () => {
      setNameValue(listName);
      focusNameInputRef.current = true;
      preventMenuAutoFocusRef.current = true;
      setEditingName(true);
    };

    useEffect(() => {
      if (!editingName || !focusNameInputRef.current) return;

      requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
        focusNameInputRef.current = false;
      });
    }, [editingName]);

    const submitNameEdit = () => {
      const trimmed = nameValue.trim();
      if (trimmed && trimmed !== listName) {
        onRenameList(listName, trimmed);
      }
      setEditingName(false);
    };

    return (
      <div
        data-testid={`list-section-${listName}`}
        className="border-b border-border/50"
      >
        {/* List header */}
        <div
          data-testid={`list-header-${listName}`}
          className="group/header sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/90 transition-colors"
          {...dragHandleAttributes}
          {...dragHandleListeners}
        >
          <button
            data-testid={`list-collapse-${listName}`}
            onClick={onToggleCollapsed}
            className="text-muted-foreground hover:text-foreground transition-transform flex-shrink-0"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          <div className="flex-1 min-w-0">
            {editingName ? (
              <Input
                ref={nameInputRef}
                data-testid={`list-name-input-${listName}`}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") submitNameEdit();
                  if (e.key === "Escape") setEditingName(false);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onBlur={submitNameEdit}
                className="h-auto bg-background py-0 text-sm"
              />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{listName}</span>
                <span className="text-[10px] text-muted-foreground">
                  {summary}
                </span>
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-1 flex-shrink-0"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {doneCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleHideCompleted}
                    className="text-muted-foreground hover:text-foreground p-0.5"
                  >
                    {hideCompleted ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {hideCompleted
                    ? "Show completed tasks"
                    : "Hide completed tasks"}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Add task"
                  onClick={() => startAdd()}
                  className="text-muted-foreground hover:text-foreground p-0.5"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add task</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`List options for ${listName}`}
                  className="text-muted-foreground hover:text-foreground p-0.5"
                >
                  <Ellipsis className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="bottom"
                align="end"
                collisionPadding={8}
                onCloseAutoFocus={(event) => {
                  if (preventMenuAutoFocusRef.current) {
                    event.preventDefault();
                    preventMenuAutoFocusRef.current = false;
                  }
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    preventMenuAutoFocusRef.current = true;
                    startAdd();
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Add task
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onToggleCollapsed}>
                  <ChevronDown className="h-3.5 w-3.5" />
                  {collapsed ? "Expand list" : "Collapse list"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onToggleHideCompleted}>
                  {hideCompleted ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  {hideCompleted
                    ? "Show completed tasks"
                    : "Hide completed tasks"}
                </DropdownMenuItem>
                {!isDefault && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={startEditName}>
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDeleteList(listName)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Add task input */}
        {adding && (
          <div className="px-3 py-2 border-b border-border/50">
            <div
              ref={addInputRef}
              contentEditable
              autoCorrect="off"
              autoCapitalize="off"
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              data-testid={`add-task-input-${listName}`}
              data-placeholder="New task... (Cmd+Enter to submit)"
              onInput={(e) => {
                const plain = getPlainText(e.currentTarget);
                setAddValue(plain);
                ac.detect();
              }}
              onKeyDown={handleAddKeyDown}
              onPaste={handlePaste}
              onBlur={() => {
                if (!ac.isOpen) {
                  if (addValue.trim()) submitAdd();
                  else setAdding(false);
                }
              }}
              className="min-h-[28px] max-h-32 overflow-y-auto w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
            />
            {ac.isOpen && (
              <AutocompleteDropdown
                anchorRef={addInputRef}
                suggestions={ac.suggestions}
                selectedIndex={ac.selectedIndex}
                onSelect={(i) => {
                  const newVal = ac.select(i);
                  if (newVal !== null) {
                    setAddValue(newVal);
                    if (addInputRef.current)
                      setPlainText(addInputRef.current, newVal);
                  }
                }}
              />
            )}
          </div>
        )}

        {/* Tasks */}
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
        >
          <div className="overflow-hidden">
            {visibleTasks.length === 0 && !adding && (
              <div className="px-3 py-3 text-xs text-muted-foreground/50 text-center">
                {hideCompleted && doneCount > 0
                  ? "All tasks completed"
                  : "No tasks"}
              </div>
            )}

            <SortableContext
              items={taskIds}
              strategy={verticalListSortingStrategy}
            >
              {visibleTasks.map((task) => (
                <SortableTaskItem
                  key={task.id}
                  task={task}
                  lists={lists}
                  relDetails={relDetails[task.id]}
                  onToggleStatus={onToggleStatus}
                  onSetStatus={onSetStatus}
                  onRename={onRename}
                  onDelete={onDelete}
                  onMove={onMove}
                  onShowStatus={onShowStatus}
                  onNavigateToTask={onNavigateToTask}
                  onCreateSubtask={handleCreateSubtask}
                  onTagClick={onTagClick}
                  showMediaPreviews={showMediaPreviews}
                  mediaPreviewResetSignal={mediaPreviewResetSignal}
                />
              ))}
            </SortableContext>
          </div>
        </div>
      </div>
    );
  },
);
