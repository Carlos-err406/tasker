import { TouchEditorScreen } from "./TouchEditorScreen.js";
import { TouchEditorActions } from "./TouchEditorActions.js";
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
  ArrowUp,
  ArrowDown,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./ui/dropdown-menu.js";
import { getHost } from "../host.js";
import { getSelectionOffsets } from "../lib/content-editable-utils.js";
import { Input } from "./ui/input.js";
import { SortableTaskItem } from "./SortableTaskItem.js";

interface ListSectionProps {
  showHeader?: boolean;
  listName: string;
  tasks: Task[];
  lists: string[];
  relDetails: Record<string, TaskRelDetails>;
  isDefault: boolean;
  onSelectList: (name: string) => void;
  onReorderList: (name: string, newIndex: number, oldIndex: number) => void;
  onEditingChange: (editing: boolean) => void;
  searching: boolean;
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
  /** All view: tasks come from every list, so show their list and add new
   *  tasks to this list instead. */
  allLists?: { addToList: string };
  hideCompleted: boolean;
  onToggleHideCompleted: () => void;
  /** Auto sort keeps system order, so tasks can't be dragged. */
  dragDisabled?: boolean;
}

export interface ListSectionHandle {
  startAdding: (initialValue?: string) => void;
}

export const ListSection = forwardRef<ListSectionHandle, ListSectionProps>(
  function ListSection(
    {
      showHeader = true,
      listName,
      tasks,
      lists,
      relDetails,
      isDefault,
      onSelectList,
      onReorderList,
      onEditingChange,
      searching,
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
      allLists,
      hideCompleted,
      onToggleHideCompleted,
      dragDisabled = false,
    },
    ref,
  ) {
    const [adding, setAdding] = useState(false);
    const [editingTasks, setEditingTasks] = useState<Set<string>>(new Set());
    const taskEditingChanged = useCallback((id: string, editing: boolean) => {
      setEditingTasks((current) => {
        if (current.has(id) === editing) return current;
        const next = new Set(current);
        if (editing) next.add(id);
        else next.delete(id);
        return next;
      });
    }, []);
    const [addValue, setAddValue] = useState("");
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState("");
    const editing = adding || editingName || editingTasks.size > 0;
    useEffect(() => {
      onEditingChange(editing);
      return () => onEditingChange(false);
    }, [editing, onEditingChange]);
    const listIndex = lists.indexOf(listName);
    const addInputRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const focusNameInputRef = useRef(false);
    const editNameAfterMenuClose = useRef(false);
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

    const startAdd = useCallback((initialValue?: string) => {
      setAdding(true);
      setAddValue(initialValue ?? "");
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
    }, []);

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
          if (!(await onAddTask(trimmed, allLists?.addToList ?? listName))) return;
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
      editNameAfterMenuClose.current = true;
      preventMenuAutoFocusRef.current = true;
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
        {showHeader && (
          <div
            data-testid={`list-header-${listName}`}
            className="group/header sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/90 transition-colors"
          >
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
                <div className="flex min-w-0 flex-col gap-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="Choose list"
                        disabled={editing}
                        title={
                          editing
                            ? "Save or cancel your edit to switch lists"
                            : undefined
                        }
                        className="list-picker flex w-full min-w-0 items-center gap-2 rounded-md text-left text-sm font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <span className="truncate">{listName}</span>
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      collisionPadding={8}
                      aria-label="Lists"
                      className="list-picker-menu w-56 max-w-[calc(100vw-24px)]"
                    >
                      <DropdownMenuRadioGroup
                        value={listName}
                        onValueChange={onSelectList}
                      >
                        {lists.map((name) => (
                          <DropdownMenuRadioItem
                            key={name}
                            value={name}
                            className="break-all"
                          >
                            {name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="text-[10px] text-muted-foreground">
                    {searching
                      ? `${totalCount} match${totalCount !== 1 ? "es" : ""}`
                      : summary}
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
                    if (editNameAfterMenuClose.current) {
                      editNameAfterMenuClose.current = false;
                      setNameValue(listName);
                      focusNameInputRef.current = true;
                      setEditingName(true);
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={listIndex <= 0 || editing}
                    onSelect={() =>
                      onReorderList(listName, listIndex - 1, listIndex)
                    }
                  >
                    <ArrowUp className="h-3.5 w-3.5" /> Move list up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={listIndex >= lists.length - 1 || editing}
                    onSelect={() =>
                      onReorderList(listName, listIndex + 1, listIndex)
                    }
                  >
                    <ArrowDown className="h-3.5 w-3.5" /> Move list down
                  </DropdownMenuItem>
                  {!isDefault && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={editing}
                        onSelect={startEditName}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={editing}
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
        )}

        {/* Add task input */}
        {adding && (
          <TouchEditorScreen
            title="New task"
            listName={allLists?.addToList ?? listName}
            onCancel={() => {
              setAdding(false);
              setAddValue("");
            }}
          >
            <div className="task-create-editor px-3 py-2 border-b border-border/50">
              <div
                ref={addInputRef}
                contentEditable
                autoCorrect="off"
                autoCapitalize="off"
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                data-testid={`add-task-input-${listName}`}
                data-placeholder={
                  getHost().touch
                    ? "Task title, then notes…"
                    : "New task... (Cmd+Enter to submit)"
                }
                onInput={(e) => {
                  const plain = getPlainText(e.currentTarget);
                  setAddValue(plain);
                  ac.detect();
                }}
                onKeyDown={handleAddKeyDown}
                onPaste={handlePaste}
                onBlur={() => {
                  if (!getHost().touch && !ac.isOpen) {
                    if (addValue.trim()) submitAdd();
                    else setAdding(false);
                  }
                }}
                className="min-h-[28px] max-h-32 overflow-y-auto overflow-x-hidden break-words [&_*]:max-w-full [&_*]:!whitespace-pre-wrap w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
              />
              <TouchEditorActions
                editor={addInputRef}
                onChange={setAddValue}
                onSave={submitAdd}
                onCancel={() => {
                  setAdding(false);
                  setAddValue("");
                }}
                onError={onShowStatus}
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
          </TouchEditorScreen>
        )}

        {/* Tasks */}
        <div>
          {visibleTasks.length === 0 && !adding && (
            <div className="px-3 py-3 text-xs text-muted-foreground/50 text-center">
              {searching && tasks.length === 0
                ? allLists
                  ? "No matching tasks"
                  : "No matching tasks in this list"
                : hideCompleted && doneCount > 0
                  ? "All tasks completed"
                  : "No tasks"}
            </div>
          )}

          <SortableContext
            items={taskIds}
            strategy={verticalListSortingStrategy}
            disabled={dragDisabled}
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
                onEditingChange={taskEditingChanged}
                showMediaPreviews={showMediaPreviews}
                mediaPreviewResetSignal={mediaPreviewResetSignal}
                showListName={!!allLists}
                onSelectList={onSelectList}
              />
            ))}
          </SortableContext>
        </div>
      </div>
    );
  },
);
