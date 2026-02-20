import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command.js';
import { parseTaskDescription, syncMetadataToDescription } from '@tasker/core/parsers';
import { Priority, TaskStatus } from '@tasker/core';
import type { Task } from '@tasker/core';
import { getDisplayTitle } from '@/lib/task-display.js';

// ---- Pure utility helpers (exported for unit testing) ----

export function isCommandMode(inputValue: string): boolean {
  return inputValue.startsWith('>');
}

export function getCommandQuery(inputValue: string): string {
  return inputValue.startsWith('>') ? inputValue.slice(1).trimStart() : inputValue;
}

export function filterTasks(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return tasks;
  const q = query.trim().toLowerCase();
  return tasks.filter(
    (t) => t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
  );
}

export function filterByLabel<T extends { label: string }>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(q));
}

// ---- Types ----

type SubPickOption = { label: string; value: string };

type TwoStepCommand = {
  id: string;
  label: string;
  group: string;
  needsSubPick: boolean;
  getSubOptions?: (task: Task) => SubPickOption[];
  execute: (task: Task, option?: SubPickOption) => void;
};

type ListStepCommand = {
  id: string;
  label: string;
  execute: (listName: string) => void;
};

type Step =
  | { type: 'root' }
  | { type: 'task-select'; command: TwoStepCommand }
  | { type: 'sub-pick'; command: TwoStepCommand; task: Task; options: SubPickOption[] }
  | { type: 'list-select'; command: ListStepCommand };

// ---- Store interface (what CommandPanel needs from the store) ----

export interface CommandPanelStore {
  tasks: Task[];
  lists: string[];
  undo: () => void;
  redo: () => void;
  refresh: () => void;
  applySystemSort: () => void;
  toggleCollapseAll: () => void;
  toggleCollapsed: (listName: string) => void;
  toggleHideCompleted: (listName: string) => void;
  setStatusTo: (taskId: string, status: TaskStatus) => void;
  rename: (taskId: string, newDescription: string) => void;
  deleteTask: (taskId: string) => void;
  moveTask: (taskId: string, targetList: string) => void;
  navigateToTask: (taskId: string) => void;
  setFilterList: (list: string | null) => void;
  showStatus: (message: string) => void;
}

export interface CommandPanelHandle {
  startAddingToList: (listName: string) => void;
}

interface CommandPanelProps {
  open: boolean;
  initialMode: 'tasks' | 'commands';
  onClose: () => void;
  store: CommandPanelStore;
  onToggleHelp: () => void;
  onToggleLogs: () => void;
  onAddTaskToList: (listName: string) => void;
}

// ---- Status icons ----
const STATUS_ICONS: Record<TaskStatus, string> = {
  [TaskStatus.Pending]: '○',
  [TaskStatus.InProgress]: '◑',
  [TaskStatus.Done]: '●',
};

// ---- Component ----

export function CommandPanel({
  open,
  initialMode,
  onClose,
  store,
  onToggleHelp,
  onToggleLogs,
  onAddTaskToList,
}: CommandPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [step, setStep] = useState<Step>({ type: 'root' });

  // Reset state when panel opens
  useEffect(() => {
    if (open) {
      setInputValue(initialMode === 'commands' ? '>' : '');
      setStep({ type: 'root' });
    }
  }, [open, initialMode]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // ---- Root step mode ----
  const cmdMode = step.type === 'root' && isCommandMode(inputValue);
  const searchQuery = step.type === 'root' ? getCommandQuery(inputValue) : inputValue;

  // ---- Filtered tasks ----
  const filteredTasks = useMemo(
    () =>
      step.type === 'root' && !cmdMode
        ? filterTasks(store.tasks, searchQuery)
        : step.type === 'task-select' || step.type === 'sub-pick'
          ? filterTasks(store.tasks, searchQuery)
          : [],
    [store.tasks, searchQuery, step.type, cmdMode],
  );

  // ---- Two-step commands ----
  const buildTwoStepCommands = useCallback((): TwoStepCommand[] => {
    const setPriorityWithOption = (task: Task, option?: SubPickOption) => {
      if (!option) return;
      const parsed = parseTaskDescription(task.description);
      const newPriority =
        option.value === 'none' ? null : (parseInt(option.value) as Priority);
      const newDesc = syncMetadataToDescription(
        task.description,
        newPriority,
        parsed.dueDate,
        parsed.tags,
        parsed.parentId,
        parsed.blocksIds,
        parsed.hasSubtaskIds,
        parsed.blockedByIds,
        parsed.relatedIds,
      );
      store.rename(task.id, newDesc);
    };

    const setDueDateWithOption = (task: Task, option?: SubPickOption) => {
      if (!option) return;
      const parsed = parseTaskDescription(task.description);
      const newDue = option.value === '' ? null : option.value;
      const newDesc = syncMetadataToDescription(
        task.description,
        parsed.priority,
        newDue,
        parsed.tags,
        parsed.parentId,
        parsed.blocksIds,
        parsed.hasSubtaskIds,
        parsed.blockedByIds,
        parsed.relatedIds,
      );
      store.rename(task.id, newDesc);
    };

    return [
      {
        id: 'edit-task',
        label: 'Edit task',
        group: 'Tasks',
        needsSubPick: false,
        execute: (task) => {
          store.navigateToTask(task.id);
          handleClose();
        },
      },
      {
        id: 'delete-task',
        label: 'Delete task',
        group: 'Tasks',
        needsSubPick: false,
        execute: (task) => {
          store.deleteTask(task.id);
          handleClose();
        },
      },
      {
        id: 'set-status',
        label: 'Set status',
        group: 'Tasks',
        needsSubPick: true,
        getSubOptions: () => [
          { label: '○ Pending', value: String(TaskStatus.Pending) },
          { label: '◑ In Progress', value: String(TaskStatus.InProgress) },
          { label: '● Done', value: String(TaskStatus.Done) },
        ],
        execute: (task, option) => {
          if (!option) return;
          store.setStatusTo(task.id, parseInt(option.value) as TaskStatus);
          handleClose();
        },
      },
      {
        id: 'set-priority',
        label: 'Set priority',
        group: 'Tasks',
        needsSubPick: true,
        getSubOptions: () => [
          { label: '🔴 High', value: String(Priority.High) },
          { label: '🟡 Medium', value: String(Priority.Medium) },
          { label: '🟢 Low', value: String(Priority.Low) },
          { label: '— None', value: 'none' },
        ],
        execute: setPriorityWithOption,
      },
      {
        id: 'set-due-date',
        label: 'Set due date',
        group: 'Tasks',
        needsSubPick: true,
        getSubOptions: (task) => {
          const parsed = parseTaskDescription(task.description);
          // Pre-populate common options
          const opts: SubPickOption[] = [
            { label: 'Today', value: new Date().toISOString().slice(0, 10) },
            {
              label: 'Tomorrow',
              value: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            },
          ];
          if (parsed.dueDate) {
            opts.push({ label: 'Clear due date', value: '' });
          }
          return opts;
        },
        execute: setDueDateWithOption,
      },
      {
        id: 'move-to-list',
        label: 'Move to list',
        group: 'Tasks',
        needsSubPick: true,
        getSubOptions: () =>
          store.lists.map((l) => ({ label: l, value: l })),
        execute: (task, option) => {
          if (!option) return;
          store.moveTask(task.id, option.value);
          handleClose();
        },
      },
      {
        id: 'create-subtask',
        label: 'Create subtask',
        group: 'Tasks',
        needsSubPick: false,
        execute: (task) => {
          onAddTaskToList(task.listName);
          handleClose();
          // Trigger subtask add with parent pre-fill after panel closes
          setTimeout(() => {
            const listSection = document.querySelector(
              `[data-testid="list-section-${task.listName}"] [data-testid="add-task-input-${task.listName}"]`,
            );
            if (listSection) {
              (listSection as HTMLTextAreaElement).value = `\n^${task.id}`;
            }
          }, 100);
        },
      },
    ];
  }, [store, handleClose, onAddTaskToList]);

  // ---- List-targeting commands ----
  const listStepCommands = useMemo(
    (): ListStepCommand[] => [
      {
        id: 'add-task-to-list',
        label: 'Add task to list',
        execute: (listName) => {
          onAddTaskToList(listName);
          handleClose();
        },
      },
      {
        id: 'switch-to-list',
        label: 'Switch to list',
        execute: (listName) => {
          store.setFilterList(listName);
          handleClose();
        },
      },
    ],
    [store, handleClose, onAddTaskToList],
  );

  // ---- Immediate commands ----
  type ImmediateCommand = {
    id: string;
    label: string;
    group: string;
    shortcut?: string;
    execute: () => void;
  };

  const buildImmediateCommands = useCallback((): ImmediateCommand[] => {
    const base: ImmediateCommand[] = [
      { id: 'undo', label: 'Undo', group: 'Actions', shortcut: '⌘Z', execute: () => { store.undo(); handleClose(); } },
      { id: 'redo', label: 'Redo', group: 'Actions', shortcut: '⌘⇧Z', execute: () => { store.redo(); handleClose(); } },
      { id: 'refresh', label: 'Refresh', group: 'Actions', shortcut: '⌘R', execute: () => { store.refresh(); handleClose(); } },
      { id: 'sort', label: 'Apply system sort', group: 'Actions', shortcut: '⌘J', execute: () => { store.applySystemSort(); handleClose(); } },
      { id: 'collapse', label: 'Collapse all lists', group: 'Actions', shortcut: '⌘E', execute: () => { store.toggleCollapseAll(); handleClose(); } },
      { id: 'help', label: 'Toggle help', group: 'Actions', shortcut: '⌘?', execute: () => { onToggleHelp(); handleClose(); } },
      { id: 'logs', label: 'Toggle logs', group: 'Actions', shortcut: '⌘L', execute: () => { onToggleLogs(); handleClose(); } },
    ];

    // Per-list commands
    for (const listName of store.lists) {
      base.push({
        id: `hide-completed-${listName}`,
        label: `Toggle hide completed — ${listName}`,
        group: 'Lists',
        execute: () => { store.toggleHideCompleted(listName); handleClose(); },
      });
      base.push({
        id: `toggle-expand-${listName}`,
        label: `Toggle expand — ${listName}`,
        group: 'Lists',
        execute: () => { store.toggleCollapsed(listName); handleClose(); },
      });
    }

    return base;
  }, [store, handleClose, onToggleHelp, onToggleLogs]);

  // ---- Render helpers ----

  const renderTaskItem = (task: Task, onSelect: (task: Task) => void) => (
    <CommandItem
      key={task.id}
      value={task.id}
      data-testid={`command-panel-task-${task.id}`}
      onSelect={() => onSelect(task)}
      className="flex items-center gap-2"
    >
      <span className="text-muted-foreground text-xs">{STATUS_ICONS[task.status as TaskStatus]}</span>
      <span className="flex-1 truncate">{getDisplayTitle(task)}</span>
      <span className="text-muted-foreground text-xs shrink-0">{task.listName}</span>
    </CommandItem>
  );

  // ---- Step: root — task mode ----
  const renderTaskMode = () => (
    <>
      <CommandGroup heading="Tasks" data-testid="command-panel-task-group">
        {filteredTasks.map((task) =>
          renderTaskItem(task, (t) => {
            store.navigateToTask(t.id);
            handleClose();
          }),
        )}
      </CommandGroup>
      <CommandEmpty>No tasks found.</CommandEmpty>
    </>
  );

  // ---- Step: root — command mode ----
  const renderCommandMode = () => {
    const twoStep = buildTwoStepCommands();
    const immediate = buildImmediateCommands();
    const listCmds = listStepCommands;

    const filteredImmediate = filterByLabel(immediate, searchQuery);
    const filteredTwoStep = filterByLabel(twoStep, searchQuery);
    const filteredListCmds = filterByLabel(listCmds, searchQuery);

    const groupedImmediate = Object.entries(
      filteredImmediate.reduce<Record<string, ImmediateCommand[]>>((acc, cmd) => {
        (acc[cmd.group] ??= []).push(cmd);
        return acc;
      }, {}),
    );

    const twoStepGroups = filteredTwoStep.length > 0 ? filteredTwoStep : [];
    const listGroups = filteredListCmds.length > 0 ? filteredListCmds : [];

    const allEmpty = groupedImmediate.length === 0 && twoStepGroups.length === 0 && listGroups.length === 0;

    return (
      <>
        {groupedImmediate.map(([group, cmds]) => (
          <CommandGroup key={group} heading={group}>
            {cmds.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                data-testid={`command-panel-cmd-${cmd.id}`}
                onSelect={cmd.execute}
              >
                <span className="flex-1">{cmd.label}</span>
                {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {twoStepGroups.length > 0 && (
          <>
            {groupedImmediate.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Task actions">
              {twoStepGroups.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.id}
                  data-testid={`command-panel-cmd-${cmd.id}`}
                  onSelect={() => {
                    setInputValue('');
                    setStep({ type: 'task-select', command: cmd });
                  }}
                >
                  <span className="flex-1">{cmd.label}</span>
                  <span className="text-muted-foreground text-xs">→ select task</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {listGroups.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Lists">
              {listGroups.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.id}
                  data-testid={`command-panel-cmd-${cmd.id}`}
                  onSelect={() => {
                    setInputValue('');
                    setStep({ type: 'list-select', command: cmd });
                  }}
                >
                  <span className="flex-1">{cmd.label}</span>
                  <span className="text-muted-foreground text-xs">→ select list</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {allEmpty && <CommandEmpty>No commands found.</CommandEmpty>}
      </>
    );
  };

  // ---- Step: task-select ----
  const renderTaskSelect = (cmd: TwoStepCommand) => (
    <>
      <CommandGroup heading={`${cmd.label} — select task`} data-testid="command-panel-step-task-select">
        {filteredTasks.map((task) =>
          renderTaskItem(task, (t) => {
            if (cmd.needsSubPick && cmd.getSubOptions) {
              const options = cmd.getSubOptions(t);
              setInputValue('');
              setStep({ type: 'sub-pick', command: cmd, task: t, options });
            } else {
              cmd.execute(t);
            }
          }),
        )}
      </CommandGroup>
      <CommandEmpty>No tasks found.</CommandEmpty>
    </>
  );

  // ---- Step: sub-pick ----
  const renderSubPick = (cmd: TwoStepCommand, task: Task, options: SubPickOption[]) => {
    const filtered = filterByLabel(options.map(o => ({ ...o })), searchQuery);
    return (
      <>
        <CommandGroup heading={`${cmd.label} — ${getDisplayTitle(task)}`} data-testid="command-panel-step-sub-pick">
          {filtered.map((opt) => (
            <CommandItem
              key={opt.value}
              value={opt.value}
              data-testid={`command-panel-subopt-${opt.value}`}
              onSelect={() => cmd.execute(task, opt)}
            >
              {opt.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandEmpty>No options found.</CommandEmpty>
      </>
    );
  };

  // ---- Step: list-select ----
  const renderListSelect = (cmd: ListStepCommand) => {
    const filtered = filterByLabel(
      store.lists.map((l) => ({ label: l, value: l })),
      searchQuery,
    );
    return (
      <>
        <CommandGroup heading={`${cmd.label} — select list`}>
          {filtered.map((opt) => (
            <CommandItem
              key={opt.value}
              value={opt.value}
              data-testid={`command-panel-list-${opt.value}`}
              onSelect={() => cmd.execute(opt.value)}
            >
              {opt.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandEmpty>No lists found.</CommandEmpty>
      </>
    );
  };

  // ---- Placeholder text ----
  const placeholder =
    step.type === 'root'
      ? cmdMode
        ? '> command…'
        : 'Go to task… (type > for commands)'
      : step.type === 'task-select'
        ? `${step.command.label} — select task…`
        : step.type === 'sub-pick'
          ? `${step.command.label} — ${getDisplayTitle(step.task)}`
          : step.type === 'list-select'
            ? `${step.command.label} — select list…`
            : '';

  // ---- Header breadcrumb (for non-root steps) ----
  const renderHeader = () => {
    if (step.type === 'root') return null;
    const label =
      step.type === 'task-select'
        ? step.command.label
        : step.type === 'sub-pick'
          ? `${step.command.label} › ${getDisplayTitle(step.task)}`
          : step.type === 'list-select'
            ? step.command.label
            : '';
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground">
        <ArrowLeft className="size-3" />
        <span>{label}</span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div data-testid="command-panel">
          {renderHeader()}
          <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-0">
            <CommandInput
              data-testid="command-panel-input"
              placeholder={placeholder}
              value={inputValue}
              onValueChange={(v) => {
                setInputValue(v);
                // If we're in a non-root step and user clears input, allow filtering
                // Reset to root if user starts typing '>' or removes '>'
              }}
            />
            <CommandList>
              {step.type === 'root' && !cmdMode && renderTaskMode()}
              {step.type === 'root' && cmdMode && renderCommandMode()}
              {step.type === 'task-select' && renderTaskSelect(step.command)}
              {step.type === 'sub-pick' && renderSubPick(step.command, step.task, step.options)}
              {step.type === 'list-select' && renderListSelect(step.command)}
            </CommandList>
          </Command>
        </div>
      </DialogContent>
    </Dialog>
  );
}
