import { useState, useRef, useMemo, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { Task, TaskStatus } from '@tasker/core/types';
import type { TaskRelDetails } from '@/hooks/use-tasker-store.js';
import { useMetadataAutocomplete } from '@/hooks/use-metadata-autocomplete.js';
import { AutocompleteDropdown } from '@/components/AutocompleteDropdown.js';
import { getPlainText, setCaretOffset, setPlainText } from '@/lib/content-editable-utils.js';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChevronDown, Plus, Ellipsis, Eye, EyeOff, Pencil, Trash2, Sparkles } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.js';
import { Input } from '@/components/ui/input.js';
import { SortableTaskItem } from './SortableTaskItem.js';

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
  onAddTask: (description: string, listName: string) => void;
  onToggleStatus: (taskId: string, currentStatus: TaskStatus) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onRename: (taskId: string, newDescription: string) => void;
  onDelete: (taskId: string, cascade?: boolean) => void;
  onMove: (taskId: string, targetList: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onShowStatus: (message: string) => void;
  onNavigateToTask: (taskId: string) => void;
  onDecompose?: (taskId: string) => void;
  onSummary?: (listName: string, timeRange: string) => void;
  lmStudioAvailable?: boolean;
  onTagClick?: (tag: string) => void;
  hideCompleted: boolean;
  onToggleHideCompleted: () => void;
}

export interface ListSectionHandle {
  startAdding: (initialValue?: string) => void;
}

export const ListSection = forwardRef<ListSectionHandle, ListSectionProps>(function ListSection({
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
  onDecompose,
  onSummary,
  lmStudioAvailable,
  onTagClick,
  hideCompleted,
  onToggleHideCompleted,
  dragHandleListeners,
  dragHandleAttributes,
}, ref) {
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [lmAvailable, setLmAvailable] = useState(lmStudioAvailable ?? false);
  const addInputRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync lmAvailable when the parent re-checks availability (e.g. on popup shown)
  useEffect(() => {
    if (lmStudioAvailable !== undefined) setLmAvailable(lmStudioAvailable);
  }, [lmStudioAvailable]);

  const handleMenuOpen = useCallback((open: boolean) => {
    if (open) {
      window.ipc['decompose:available']()
        .then(setLmAvailable)
        .catch(() => setLmAvailable(false));
    }
  }, []);

  const ac = useMetadataAutocomplete(addValue, addInputRef);

  const visibleTasks = useMemo(
    () => hideCompleted ? tasks.filter((t) => t.status !== 2 && t.status !== 3) : tasks,
    [tasks, hideCompleted],
  );

  const taskIds = useMemo(() => visibleTasks.map((t) => t.id), [visibleTasks]);

  const pendingCount = tasks.filter((t) => t.status === 0).length;
  const doneCount = tasks.filter((t) => t.status === 2 || t.status === 3).length;
  const totalCount = tasks.length;
  const hiddenDoneCount = hideCompleted ? doneCount : 0;
  const summaryParts: string[] = [];
  summaryParts.push(`${totalCount} task${totalCount !== 1 ? 's' : ''}`);
  if (pendingCount < totalCount) summaryParts.push(`${pendingCount} pending`);
  if (hiddenDoneCount > 0) summaryParts.push(`+${hiddenDoneCount} done`);
  const summary = summaryParts.join(', ');

  const startAdd = (initialValue?: string) => {
    setAdding(true);
    setAddValue(initialValue ?? '');
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
  };

  useImperativeHandle(ref, () => ({ startAdding: startAdd }), [startAdd]);

  const submitAdd = () => {
    const trimmed = addValue.trim();
    if (trimmed) {
      onAddTask(trimmed, listName);
    }
    setAdding(false);
    setAddValue('');
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    // Stop propagation so dnd-kit keyboard listeners don't intercept (e.g. Space)
    e.stopPropagation();
    // 1. Metadata autocomplete takes priority
    if (ac.onKeyDown(e)) {
      if ((e.key === 'Enter' || e.key === 'Tab') && ac.isOpen) {
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
    if (e.key === 'Escape') {
      setAdding(false);
      return;
    }
    // 3. Submit
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitAdd();
    }
  };

  const startEditName = () => {
    setNameValue(listName);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const submitNameEdit = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== listName) {
      onRenameList(listName, trimmed);
    }
    setEditingName(false);
  };

  return (
    <div data-testid={`list-section-${listName}`} className="border-b border-border/50">
      {/* List header */}
      <div data-testid={`list-header-${listName}`} className="group/header sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/90 transition-colors" {...dragHandleAttributes} {...dragHandleListeners}>
        <button
          data-testid={`list-collapse-${listName}`}
          onClick={onToggleCollapsed}
          className="text-muted-foreground hover:text-foreground transition-transform flex-shrink-0"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1 min-w-0">
          {editingName ? (
            <Input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submitNameEdit();
                if (e.key === 'Escape') setEditingName(false);
              }}
              onBlur={submitNameEdit}
              className="h-auto bg-background py-0 text-sm"
            />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{listName}</span>
              <span className="text-[10px] text-muted-foreground">{summary}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {doneCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleHideCompleted}
                  className="text-muted-foreground hover:text-foreground p-0.5"
                >
                  {hideCompleted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => startAdd()}
                className="text-muted-foreground hover:text-foreground p-0.5"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Add task</TooltipContent>
          </Tooltip>

          <DropdownMenu onOpenChange={handleMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground p-0.5">
                <Ellipsis className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" collisionPadding={8}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <DropdownMenuItem
                      onSelect={() => onSummary?.(listName, '7d')}
                      disabled={!lmAvailable}
                      className={!lmAvailable ? 'pointer-events-none' : undefined}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Summarize
                    </DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                {!lmAvailable && (
                  <TooltipContent side="left">LM Studio server is not running</TooltipContent>
                )}
              </Tooltip>
              {!isDefault && (
                <>
                  <DropdownMenuItem onSelect={startEditName}>
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => onDeleteList(listName)}>
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
                  if (addInputRef.current) setPlainText(addInputRef.current, newVal);
                }
              }}
            />
          )}
        </div>
      )}

      {/* Tasks */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          {visibleTasks.length === 0 && !adding && (
            <div className="px-3 py-3 text-xs text-muted-foreground/50 text-center">
              {hideCompleted && doneCount > 0 ? 'All tasks completed' : 'No tasks'}
            </div>
          )}

          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
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
                onCreateSubtask={(taskId) => startAdd(`\n^${taskId}`)}
                onDecompose={onDecompose}
                lmStudioAvailable={lmStudioAvailable}
                onTagClick={onTagClick}
              />
            ))}
          </SortableContext>
        </div>
      </div>
    </div>
  );
});
