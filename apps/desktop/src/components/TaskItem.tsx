import { useState, useRef, useCallback, useEffect } from 'react';
import type { Task, TaskStatus } from '@tasker/core/types';
import { TaskStatus as TS } from '@tasker/core/types';
import type { TaskRelDetails } from '@/hooks/use-tasker-store.js';
import { cn } from '@/lib/utils.js';
import { useMetadataAutocomplete } from '@/hooks/use-metadata-autocomplete.js';
import { useMarkdownShortcuts } from '@/hooks/use-markdown-shortcuts.js';
import { AutocompleteDropdown } from '@/components/AutocompleteDropdown.js';
import { Check, Minus, CornerLeftUp, CornerRightDown, Ban, Link2, Calendar, Tag, Sparkles, Pencil, Trash2, FolderInput, Circle, CircleDot, CircleCheck } from 'lucide-react';
import { MarkdownContent } from '@/components/MarkdownContent.js';
import { Textarea } from '@/components/ui/textarea.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu.js';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip.js';
import {
  getDisplayTitle,
  getDescriptionPreview,
  getShortId,
  isDone,
  isInProgress,
  getPriorityIndicator,
  getPriorityColor,
  getDueDateColor,
  formatDueDate,
  getTagColor,
  getLinkedStatusLabel,
  getLinkedStatusColor,
} from '@/lib/task-display.js';

interface TaskItemProps {
  task: Task;
  lists: string[];
  relDetails?: TaskRelDetails;
  onToggleStatus: (taskId: string, currentStatus: TaskStatus) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onRename: (taskId: string, newDescription: string) => void;
  onDelete: (taskId: string, cascade?: boolean) => void;
  onMove: (taskId: string, targetList: string) => void;
  onShowStatus: (message: string) => void;
  onNavigateToTask: (taskId: string) => void;
  onCreateSubtask: (taskId: string) => void;
  onDecompose?: (taskId: string) => void;
  lmStudioAvailable?: boolean;
  onTagClick?: (tag: string) => void;
}

export function TaskItem({
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
  onDecompose,
  lmStudioAvailable,
  onTagClick,
}: TaskItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ac = useMetadataAutocomplete(editValue, inputRef, task.id);
  const md = useMarkdownShortcuts(inputRef, setEditValue);

  // Trigger autocomplete detection on value changes
  useEffect(() => {
    if (editing) ac.detect();
  }, [editValue, editing]);

  const done = isDone(task);
  const inProg = isInProgress(task);
  const title = getDisplayTitle(task);
  const descPreview = getDescriptionPreview(task);
  const shortId = getShortId(task);
  const priorityIndicator = getPriorityIndicator(task.priority);
  const priorityColor = getPriorityColor(task.priority);
  const dueDateLabel = formatDueDate(task.dueDate);
  const dueDateColor = getDueDateColor(task.dueDate);

  const handleToggleCheckbox = useCallback((contentLineNumber: number) => {
    // descPreview (content) corresponds to lines after the title in task.description,
    // offset by any leading blank lines that getDescriptionPreview trims.
    const descLines = task.description.split('\n');
    let bodyStart = 1; // skip title (line 0)
    while (bodyStart < descLines.length && descLines[bodyStart]!.trim() === '') bodyStart++;

    const targetLine = bodyStart + contentLineNumber;
    if (targetLine >= descLines.length) return;

    // Toggle the first checkbox pattern on this line
    descLines[targetLine] = descLines[targetLine]!.replace(
      /\[[ xX]\]/,
      (match) => (match === '[ ]' ? '[x]' : '[ ]'),
    );

    const newDescription = descLines.join('\n');
    if (newDescription !== task.description) {
      onRename(task.id, newDescription);
    }
  }, [task.description, task.id, onRename]);

  const startEdit = () => {
    setEditValue(task.description);
    setEditing(true);
    // Delay focus to let Radix ContextMenu finish closing and restoring focus
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }
    }, 50);
  };

  const submitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.description) {
      onRename(task.id, trimmed);
    }
    setEditing(false);
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const hasImage = Array.from(e.clipboardData.types).includes('image/png')
      || Array.from(e.clipboardData.types).includes('image/jpeg')
      || Array.from(e.clipboardData.files).some((f) => f.type.startsWith('image/'));

    if (!hasImage) return; // Allow normal text paste

    e.preventDefault();

    const savedPath = await window.ipc['clipboard:saveImage']();
    if (!savedPath) return;

    const el = inputRef.current;
    if (!el) return;

    const before = editValue.slice(0, el.selectionStart);
    const after = editValue.slice(el.selectionEnd);
    const insertion = `![image](${savedPath})`;
    const newValue = before + insertion + after;
    setEditValue(newValue);

    // Place cursor after the inserted markdown
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
  }, [editValue, setEditValue]);

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Stop propagation so dnd-kit keyboard listeners don't intercept (e.g. Space)
    e.stopPropagation();
    // Let autocomplete handle its keys first
    if (ac.onKeyDown(e)) {
      if ((e.key === 'Enter' || e.key === 'Tab') && ac.isOpen) {
        const newVal = ac.select(ac.selectedIndex);
        if (newVal !== null) setEditValue(newVal);
      }
      return;
    }
    // Markdown shortcuts (Cmd+B, Cmd+I, Cmd+Shift+I, Cmd+K, Tab for tab-stops)
    if (md.onKeyDown(e)) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitEdit();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      setEditing(false);
    }
  };

  const handleCheckboxClick = () => {
    onToggleStatus(task.id, task.status);
  };

  const handleCheckboxContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onSetStatus(task.id, inProg ? TS.Pending : TS.InProgress);
  };

  const copyId = () => {
    navigator.clipboard.writeText(shortId);
    onShowStatus(`Copied: ${shortId}`);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid={`task-item-${shortId}`}
          className={cn(
            'group flex items-start gap-2 px-3 py-2 transition-colors hover:bg-accent/50',
          )}
        >
          {/* Checkbox + ID column */}
          <div className={cn('flex flex-col items-center mt-0.5', done && 'opacity-60')}>
            <button
              data-testid={`task-checkbox-${shortId}`}
              onClick={handleCheckboxClick}
              onContextMenu={handleCheckboxContextMenu}
              className={cn(
                'h-4 w-4 rounded border transition-colors flex items-center justify-center',
                done
                  ? 'border-green-500 bg-green-500/20 text-green-400'
                  : inProg
                    ? 'border-amber-400 bg-amber-400/20 text-amber-400'
                    : 'border-muted-foreground/40 hover:border-foreground/60',
              )}
            >
              {done && <Check className="h-3 w-3" />}
              {inProg && <Minus className="h-3 w-3" />}
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={copyId}
                  className="mt-0.5 font-mono text-[9px] text-muted-foreground/50 hover:text-muted-foreground"
                >
                  {shortId}
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy ID</TooltipContent>
            </Tooltip>
          </div>

          {/* Content column */}
          <div className="flex-1 min-w-0 select-text">
            {editing ? (
              <div className="relative">
                <Textarea
                  data-testid="task-edit-input"
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onKeyDown={handleEditKeyDown}
                  onPaste={handlePaste}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={() => {
                    if (!ac.isOpen) submitEdit();
                  }}
                  className="min-h-0 field-sizing-fixed bg-background px-2 py-1 text-sm resize-none overflow-hidden"
                  rows={1}
                />
                {ac.isOpen && (
                  <AutocompleteDropdown
                    suggestions={ac.suggestions}
                    selectedIndex={ac.selectedIndex}
                    onSelect={(i) => {
                      const newVal = ac.select(i);
                      if (newVal !== null) setEditValue(newVal);
                    }}
                  />
                )}
              </div>
            ) : (
              <div className={cn(done && 'opacity-60')}>
                <div className="flex items-start gap-1.5">
                  {priorityIndicator && (
                    <span className={cn('text-xs font-mono font-bold mt-0.5', priorityColor)}>
                      {priorityIndicator}
                    </span>
                  )}
                  <span
                    data-testid={`task-name-${shortId}`}
                    className={cn(
                      'text-sm leading-tight',
                      done && 'line-through text-muted-foreground',
                    )}
                  >
                    {title}
                  </span>
                </div>

                {/* Description preview */}
                {descPreview && <MarkdownContent content={descPreview} onToggleCheckbox={handleToggleCheckbox} />}

                {/* Relationship lines */}
                {relDetails?.parent && (
                  <button onClick={() => onNavigateToTask(relDetails.parent!.id)} className="flex w-full items-start gap-1 font-mono text-[10px] text-muted-foreground mt-0.5 hover:text-foreground transition-colors text-left">
                    <CornerLeftUp className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 min-w-0">Subtask of ({relDetails.parent.id}) {relDetails.parent.title}</span>
                    {getLinkedStatusLabel(relDetails.parent.status) && (
                      <span className={cn('flex-shrink-0', getLinkedStatusColor(relDetails.parent.status))}>{getLinkedStatusLabel(relDetails.parent.status)}</span>
                    )}
                  </button>
                )}
                {relDetails?.subtasks.map((s) => (
                  <button key={s.id} onClick={() => onNavigateToTask(s.id)} className="flex w-full items-start gap-1 font-mono text-[10px] text-muted-foreground mt-0.5 hover:text-foreground transition-colors text-left">
                    <CornerRightDown className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 min-w-0">Subtask ({s.id}) {s.title}</span>
                    {getLinkedStatusLabel(s.status) && (
                      <span className={cn('flex-shrink-0', getLinkedStatusColor(s.status))}>{getLinkedStatusLabel(s.status)}</span>
                    )}
                  </button>
                ))}
                {relDetails?.blocks.map((b) => (
                  <button key={b.id} onClick={() => onNavigateToTask(b.id)} className="flex w-full items-start gap-1 font-mono text-[10px] text-amber-400/80 mt-0.5 hover:text-foreground transition-colors text-left">
                    <Ban className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 min-w-0">Blocks ({b.id}) {b.title}</span>
                    {getLinkedStatusLabel(b.status) && (
                      <span className={cn('flex-shrink-0', getLinkedStatusColor(b.status))}>{getLinkedStatusLabel(b.status)}</span>
                    )}
                  </button>
                ))}
                {relDetails?.blockedBy.map((b) => (
                  <button key={b.id} onClick={() => onNavigateToTask(b.id)} className="flex w-full items-start gap-1 font-mono text-[10px] text-amber-400/80 mt-0.5 hover:text-foreground transition-colors text-left">
                    <Ban className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 min-w-0">Blocked by ({b.id}) {b.title}</span>
                    {getLinkedStatusLabel(b.status) && (
                      <span className={cn('flex-shrink-0', getLinkedStatusColor(b.status))}>{getLinkedStatusLabel(b.status)}</span>
                    )}
                  </button>
                ))}
                {relDetails?.related.map((r) => (
                  <button key={r.id} onClick={() => onNavigateToTask(r.id)} className="flex w-full items-start gap-1 font-mono text-[10px] text-teal-400/80 mt-0.5 hover:text-foreground transition-colors text-left">
                    <Link2 className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 min-w-0">Related to ({r.id}) {r.title}</span>
                    {getLinkedStatusLabel(r.status) && (
                      <span className={cn('flex-shrink-0', getLinkedStatusColor(r.status))}>{getLinkedStatusLabel(r.status)}</span>
                    )}
                  </button>
                ))}

                {/* Due date */}
                {dueDateLabel && (
                  <div className={cn('flex items-center gap-1 font-mono text-[10px] mt-0.5', dueDateColor)}>
                    <Calendar className="h-3 w-3 flex-shrink-0" />
                    {dueDateLabel.charAt(0).toUpperCase() + dueDateLabel.slice(1)}
                  </div>
                )}

                {/* Tags */}
                {task.tags && task.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {task.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTagClick?.(tag);
                        }}
                        className={cn(
                          'inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0 rounded-full hover:brightness-125 transition-all',
                          getTagColor(tag),
                        )}
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={startEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCreateSubtask(task.id)}>
          <CornerRightDown className="h-3.5 w-3.5" />
          Create subtask
        </ContextMenuItem>
        {lmStudioAvailable ? (
          <ContextMenuItem onSelect={() => onDecompose?.(task.id)}>
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Decompose with AI
          </ContextMenuItem>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuItem disabled>
                <Sparkles className="h-3.5 w-3.5" />
                Decompose with AI
              </ContextMenuItem>
            </TooltipTrigger>
            <TooltipContent side="right">LM Studio is not running</TooltipContent>
          </Tooltip>
        )}

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="h-3.5 w-3.5" />
            Move to...
          </ContextMenuSubTrigger>
          <ContextMenuSubContent collisionPadding={8}>
            {lists
              .filter((l) => l !== task.listName)
              .map((l) => (
                <ContextMenuItem key={l} onSelect={() => onMove(task.id, l)}>
                  {l}
                </ContextMenuItem>
              ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Set Status</ContextMenuSubTrigger>
          <ContextMenuSubContent collisionPadding={8}>
            {[
              { label: 'Pending', status: TS.Pending, icon: <Circle className="h-3.5 w-3.5 text-muted-foreground" /> },
              { label: 'In Progress', status: TS.InProgress, icon: <CircleDot className="h-3.5 w-3.5 text-amber-400" /> },
              { label: 'Done', status: TS.Done, icon: <CircleCheck className="h-3.5 w-3.5 text-green-400" /> },
            ].map(({ label, status, icon }) => (
              <ContextMenuItem
                key={label}
                onSelect={() => onSetStatus(task.id, status)}
                className={cn(task.status === status && 'font-medium')}
              >
                {icon}
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />
        {relDetails && relDetails.subtasks.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger className="text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
              Delete...
            </ContextMenuSubTrigger>
            <ContextMenuSubContent collisionPadding={8}>
              <ContextMenuItem variant="destructive" onSelect={() => onDelete(task.id, false)}>
                This task only
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={() => onDelete(task.id, true)}>
                Task and subtasks
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(task.id)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
