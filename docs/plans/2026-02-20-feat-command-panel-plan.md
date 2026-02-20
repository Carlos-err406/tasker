---
title: "feat: Command Panel (VSCode-style Cmd+P / Cmd+Shift+P)"
type: feat
status: completed
date: 2026-02-20
brainstorm: docs/brainstorms/2026-02-20-command-panel-brainstorm.md
task: u4s
---

# feat: Command Panel (VSCode-style Cmd+P / Cmd+Shift+P)

## Overview

Add a VSCode-style floating command panel to the desktop tray app. Two keyboard shortcuts open the same overlay component in different modes:

- **`Cmd+P`** — Task mode: quickly find and navigate to any task (ephemeral, does not affect the search bar)
- **`Cmd+Shift+P`** — Command mode: filterable list of actions to execute

The panel uses the **shadcn/ui `Command` component** (already installed — `components.json` exists). The existing search bar is **kept** for persistent filtering; the command panel is purely additive.

---

## Scope

### In scope
- `CommandPanel.tsx` component using `CommandDialog` (Radix Dialog portal)
- Task mode: in-memory search across `store.tasks`, navigate on selection
- Command mode: immediate commands + two-step task-targeting + two-step list-targeting
- Three-step flow for sub-pickers (status, priority, list) — inside the panel
- `Cmd+P` and `Cmd+Shift+P` added to `useKeyboardShortcuts`
- `Cmd+K` removed (redundant with `Cmd+P`)
- Unit tests for filtering logic and step transitions
- E2E tests for all user flows

### Out of scope
- "Decompose with AI" command (planned separately as part of task decomposition feature)
- Replacing the search bar (intentionally kept for persistent filtering)
- CLI command palette

---

## Technical Approach

### Architecture

The `CommandPanel` component is a self-contained overlay using `CommandDialog`. It manages a 3-step internal state machine:

```
step: 'root' → inputValue starts with '>' → command mode
             → no prefix → task mode

step: 'task-select' → triggered by two-step command selection
                    → shows filterable task list
                    → Escape closes entirely

step: 'sub-pick'    → triggered after task selection for commands
                    → that need a sub-option (status, priority, list)
                    → Escape closes entirely
```

```tsx
// CommandPanel.tsx internal state shape
type Step =
  | { type: 'root' }
  | { type: 'task-select'; command: TwoStepCommand }
  | { type: 'sub-pick'; command: TwoStepCommand; task: Task; options: SubPickOption[] }

type TwoStepCommand = {
  id: string
  label: string
  needsSubPick: boolean
  getSubOptions?: (task: Task) => SubPickOption[]
  execute: (task: Task, option?: SubPickOption) => void
}

type SubPickOption = { label: string; value: string }
```

The `>` prefix is stripped from `inputValue` before filtering in command mode.

### "Add task to list" — Imperative API

The panel needs to imperatively open the add-input in a specific list after closing. This requires:
- `useImperativeHandle` on `SortableListSection`, exposing `startAdding(text?: string)`
- In `app.tsx`, a `listSectionRefs` map: `Record<string, RefObject<SortableListSectionHandle>>`
- After the panel closes with an "Add task to list" command, call `listSectionRefs[listName].current?.startAdding()`

### LM Studio availability

AI commands are deferred until the Decompose feature is built. No availability check needed in this plan.

---

## Implementation Phases

### Phase 1: shadcn/ui setup verification + Command component

shadcn/ui is **already initialized** in this project (`apps/desktop/components.json` exists, `kbd.tsx` and `tooltip.tsx` are present in `src/components/ui/`). Do **not** re-run `shadcn init` — it would overwrite `components.json` and `src/styles.css`.

**Verification checklist:**

```bash
# From apps/desktop/

# 1. Confirm shadcn is initialized
cat components.json   # should show aliases, tailwind config path, etc.

# 2. Confirm CSS variables + Tailwind v4 theme exist
grep -c "oklch" src/styles.css   # should be > 0

# 3. Confirm @/ alias resolves to ./src in both configs
grep "@/" vite.config.ts tsconfig.json

# 4. Confirm lib/utils.ts exists (shadcn helper)
ls src/lib/utils.ts
```

**Add the Command component:**

```bash
# From apps/desktop/
pnpm dlx shadcn@latest add command
```

**Verify after install:**
- `src/components/ui/command.tsx` is created
- `cmdk` appears in `apps/desktop/package.json` dependencies
- `pnpm --filter @tasker/desktop run build` passes cleanly
- Import test: add `import { Command } from '@/components/ui/command'` to a temp file and confirm no TypeScript errors

**If `src/lib/utils.ts` is missing** (the shadcn `cn()` helper):

```bash
pnpm dlx shadcn@latest add --all  # will regenerate utils if absent
```

Or create it manually:
```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

> **Note:** `clsx` and `tailwind-merge` are already in `package.json` dev dependencies.

---

### Phase 2: CommandPanel skeleton

**New file:** `apps/desktop/src/components/CommandPanel.tsx`

```tsx
// CommandPanel.tsx — props
interface CommandPanelProps {
  open: boolean
  initialMode: 'tasks' | 'commands'
  onClose: () => void
  tasks: Task[]
  lists: string[]
  store: ReturnType<typeof useTaskerStore>
  listSectionRefs: Record<string, RefObject<SortableListSectionHandle>>
}
```

- Wraps shadcn `CommandDialog`
- `data-testid="command-panel"` on the outer dialog
- `data-testid="command-panel-input"` on `CommandInput`
- Mode derived from `inputValue.startsWith('>')`
- On open with `initialMode === 'commands'`: set initial `inputValue` to `'>'`
- Escape always closes entirely (no back navigation): handled by `CommandDialog`'s `onOpenChange`

---

### Phase 3: Task mode

Inside the panel when `!inputValue.startsWith('>')`:

- Filter `tasks` in-memory: case-insensitive substring match on `task.name`
- Show `CommandItem` per task with: task name, list badge, status icon
- `data-testid={`command-panel-task-${task.id}`}` on each item
- `onSelect`: call `store.navigateToTask(task.id)`, then `onClose()`
- Empty state: `CommandEmpty` — "No tasks found"
- Show all tasks unfiltered when input is empty

---

### Phase 4: Command mode — immediate commands

When `inputValue.startsWith('>')`, strip `>`, filter commands by remaining text.

**Command registry** (defined as a const array in `CommandPanel.tsx`):

```tsx
type ImmediateCommand = {
  id: string
  label: string
  shortcut?: string
  execute: () => void
  disabled?: boolean
}
```

**Immediate commands list:**

| Label | Shortcut | Action |
|-------|----------|--------|
| Undo | ⌘Z | `store.undo()` |
| Redo | ⌘⇧Z | `store.redo()` |
| Refresh | ⌘R | `store.refresh()` |
| Apply system sort | ⌘J | `store.applySystemSort()` |
| Collapse all lists | ⌘E | `store.toggleCollapseAll()` |
| Toggle help | ⌘? | `onToggleHelp()` |
| Toggle logs | ⌘L | `onToggleLogs()` |
| Toggle hide completed — [listName] | — | `store.toggleHideCompleted(listName)` per list |
| Toggle expand — [listName] | — | `store.toggleCollapsed(listName)` per list |

Per-list commands are generated dynamically from `lists`.

---

### Phase 5: Command mode — two-step task-targeting commands

On selecting one of these commands, transition to `step = 'task-select'`:

| Label | Step 3 needed | Action |
|-------|--------------|--------|
| Edit task | No | `store.startInlineEdit(task.id)` (see note) |
| Delete task | No | `store.deleteTask(task.id)` |
| Set status | Yes — show Pending / In Progress / Done | `store.setStatusTo(task.id, status)` |
| Set priority | Yes — show High / Medium / Low / None | `store.setPriority(task.id, priority)` |
| Set due date | Yes — show text input | `store.setDueDate(task.id, date)` |
| Move to list | Yes — show list picker | `store.moveTask(task.id, listName)` |
| Create subtask | No | opens add-input with `\n^${task.id}` in task's list |

> **Note on "Edit task":** There is no current `startInlineEdit` store action. After selecting the task, call `store.navigateToTask(task.id)` and then dispatch a `START_INLINE_EDIT` action that `TaskItem` listens to via a `useEffect` to auto-focus its edit input. This requires a new `editingTaskId: string | null` field in the store and a `SET_EDITING_TASK` action.

In `step = 'task-select'`:
- Header: `← [Command label] | Select task...`
- `inputValue` is reset to `''` on entering this step
- Same in-memory filtering as task mode
- `data-testid="command-panel-step-task-select"` on step indicator

In `step = 'sub-pick'`:
- Header: task name
- Shows sub-options as `CommandItem` rows
- For "Set due date": a plain text input within the panel (not `CommandInput`)
- `data-testid="command-panel-step-sub-pick"` on step indicator

---

### Phase 6: List-targeting commands

Two commands transition to a list picker (same pattern as task-select, but shows lists):

| Label | After list selected |
|-------|---------------------|
| Add task to list | `listSectionRefs[listName].current?.startAdding()`, then `onClose()` |
| Switch to list | `store.setFilterList(listName)`, then `onClose()` |

---

### Phase 7: Keyboard shortcuts + Cmd+K removal

**`apps/desktop/src/hooks/use-keyboard-shortcuts.ts`**

Add to `ShortcutHandlers` interface:
```ts
onOpenCommandTasks?: () => void  // Cmd+P
onOpenCommandPalette?: () => void // Cmd+Shift+P
```

Add cases to the `keydown` handler:
```ts
if (e.key === 'p' && e.metaKey && !e.shiftKey) {
  e.preventDefault()
  handlers.onOpenCommandTasks?.()
}
if (e.key === 'p' && e.metaKey && e.shiftKey) {
  e.preventDefault()
  handlers.onOpenCommandPalette?.()
}
```

Remove the `Cmd+K` / `onFocusSearch` handler entirely.

**`apps/desktop/src/app.tsx`**

```tsx
const [commandPanelOpen, setCommandPanelOpen] = useState(false)
const [commandPanelMode, setCommandPanelMode] = useState<'tasks' | 'commands'>('tasks')
```

Wire keyboard shortcuts:
```tsx
onOpenCommandTasks: () => { setCommandPanelMode('tasks'); setCommandPanelOpen(true) }
onOpenCommandPalette: () => { setCommandPanelMode('commands'); setCommandPanelOpen(true) }
```

Add `<CommandPanel>` to JSX (alongside HelpPanel/LogsPanel, not in the ternary — it's a floating overlay, so it renders independently via portal):
```tsx
<CommandPanel
  open={commandPanelOpen}
  initialMode={commandPanelMode}
  onClose={() => setCommandPanelOpen(false)}
  tasks={store.tasks}
  lists={store.lists}
  store={store}
  listSectionRefs={listSectionRefs}
/>
```

Remove `searchRef`, `onFocusSearch` wiring, and the `Cmd+K` handler from `useKeyboardShortcuts` call.

**`apps/desktop/src/components/HelpPanel.tsx`**

Update keyboard reference table: remove `⌘K`, add `⌘P` (Task search) and `⌘⇧P` (Commands).

---

### Phase 8: SortableListSection imperative handle

**`apps/desktop/src/components/SortableListSection.tsx`**

```tsx
export interface SortableListSectionHandle {
  startAdding(text?: string): void
}

export const SortableListSection = forwardRef<SortableListSectionHandle, Props>((props, ref) => {
  const innerRef = useRef<ListSectionHandle>(null)

  useImperativeHandle(ref, () => ({
    startAdding(text) { innerRef.current?.startAdding(text) }
  }))
  // ...
})
```

**`apps/desktop/src/components/ListSection.tsx`** — expose `startAdding` via `useImperativeHandle` (or already has it as a function; check the existing `startAdd` callback).

---

### Phase 9: Store additions

**`apps/desktop/src/hooks/use-tasker-store.ts`**

New action:
```ts
| { type: 'SET_EDITING_TASK'; taskId: string | null }
```

New state field:
```ts
editingTaskId: string | null  // null = no task being edited
```

New public function:
```ts
setEditingTask: (taskId: string | null) => void
```

`TaskItem.tsx` — add `useEffect` watching `store.editingTaskId`:
```tsx
useEffect(() => {
  if (store.editingTaskId === task.id) {
    startEditing()          // existing inline edit activation
    store.setEditingTask(null) // clear after activating
  }
}, [store.editingTaskId])
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/components/ui/command.tsx` | **New** (generated by `shadcn add command`) |
| `src/components/CommandPanel.tsx` | **New** — main component |
| `src/hooks/use-keyboard-shortcuts.ts` | Add Cmd+P/Cmd+Shift+P; remove Cmd+K |
| `src/app.tsx` | Add panel state, wire shortcuts, render `<CommandPanel>` |
| `src/components/HelpPanel.tsx` | Update keyboard reference |
| `src/components/SortableListSection.tsx` | Add `useImperativeHandle` |
| `src/components/ListSection.tsx` | Expose `startAdding` handle |
| `src/hooks/use-tasker-store.ts` | Add `SET_EDITING_TASK`, `editingTaskId`, `setEditingTask` |
| `src/components/TaskItem.tsx` | Watch `editingTaskId` to trigger inline edit |
| `e2e/command-panel.spec.ts` | **New** — E2E tests |
| `src/components/ui/command.test.tsx` | **New** — unit tests |

---

## Testing

### Unit Tests — `src/components/ui/command.test.tsx`

Using `vitest` + `@testing-library/react`:

```
describe('CommandPanel filtering')
  ✓ task mode: returns all tasks when input is empty
  ✓ task mode: filters tasks by substring match (case-insensitive)
  ✓ task mode: returns empty when no match
  ✓ command mode: activated by '>' prefix
  ✓ command mode: filters commands by label substring
  ✓ command mode: strips '>' before filtering
  ✓ mode switching: typing '>' switches from task to command mode
  ✓ mode switching: deleting '>' returns to task mode

describe('CommandPanel step transitions')
  ✓ two-step command: transitions to task-select step on selection
  ✓ two-step command: shows task list in task-select step
  ✓ sub-pick command: transitions to sub-pick step after task selection
  ✓ sub-pick: shows correct options for 'Set status'
  ✓ sub-pick: shows correct options for 'Set priority'
```

### E2E Tests — `e2e/command-panel.spec.ts`

```ts
import { test, expect } from './fixtures.js'
import { addTask, waitForSearchDebounce } from './helpers.js'
```

```
describe('Command Panel')

  describe('Cmd+P — task mode')
    ✓ opens panel on Cmd+P
    ✓ shows all tasks unfiltered on open
    ✓ filters tasks by typing
    ✓ navigates to task and closes panel on Enter
    ✓ closes on Escape
    ✓ panel does not affect search bar state

  describe('Cmd+Shift+P — command mode')
    ✓ opens panel with '>' pre-filled
    ✓ shows command list in command mode
    ✓ filters commands by label
    ✓ executes Undo command and closes panel
    ✓ executes Collapse all lists command
    ✓ closes on Escape

  describe('Mode switching')
    ✓ typing '>' in task mode switches to command mode
    ✓ deleting '>' returns to task mode

  describe('Two-step: Set status')
    ✓ transitions to task-select step after selecting 'Set status'
    ✓ header shows 'Set status | Select task...'
    ✓ transitions to sub-pick step after selecting a task
    ✓ status options appear: Pending, In Progress, Done
    ✓ task status updated after selecting option
    ✓ panel closes after completion
    ✓ Escape from task-select closes panel entirely

  describe('Two-step: Move to list')
    ✓ transitions to list picker after task selection
    ✓ task moved to selected list
    ✓ panel closes after completion
```

**Key E2E patterns to use:**
```ts
// Open command panel
await page.keyboard.press('Meta+p')
await expect(page.getByTestId('command-panel')).toBeVisible()

// Open in command mode
await page.keyboard.press('Meta+Shift+p')
await expect(page.getByTestId('command-panel-input')).toHaveValue('>')

// Type in panel input
await page.getByTestId('command-panel-input').fill('my task')
await waitForSearchDebounce(page)

// Navigate to task
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
await expect(page.getByTestId('command-panel')).not.toBeVisible()

// Check panel is closed
await expect(page.getByTestId('command-panel')).not.toBeVisible()
```

---

## Acceptance Criteria

### Functional

- [x] `Cmd+P` opens the panel in task mode (empty input)
- [x] `Cmd+Shift+P` opens the panel with `>` pre-filled (command mode)
- [x] Typing `>` in task mode switches to command mode; deleting `>` returns to task mode
- [x] Task mode: in-memory filter of all tasks by substring; selecting a task calls `navigateToTask()` and closes
- [x] Task mode: does not affect the search bar or `store.searchQuery`
- [x] Command mode: all immediate commands execute correctly and close the panel
- [x] Command mode: two-step commands transition to task-select step
- [x] Sub-pick step: shows correct options for Set status, Set priority, Set due date, Move to list
- [x] List-targeting "Add task to list": opens the add-input in the correct list
- [x] List-targeting "Switch to list": scrolls/focuses the correct list
- [x] Escape always closes the panel (no back navigation)
- [x] `Cmd+K` is removed; HelpPanel keyboard reference updated
- [x] Search bar continues to work independently for persistent filtering
- [x] `Toggle hide completed — [list]` and `Toggle expand — [list]` appear for each list

### Quality

- [x] All unit tests pass (`vitest`)
- [x] All E2E tests pass (`pnpm test:e2e`)
- [x] `pnpm typecheck` passes
- [x] `pnpm --filter @tasker/desktop run build` passes

---

## Dependencies & Prerequisites

- shadcn/ui Command: `pnpm dlx shadcn@latest add command` (from `apps/desktop/`)
- No core package changes needed

---

## References

- Brainstorm: `docs/brainstorms/2026-02-20-command-panel-brainstorm.md`
- Keyboard shortcuts: `apps/desktop/src/hooks/use-keyboard-shortcuts.ts`
- Panel pattern: `apps/desktop/src/components/HelpPanel.tsx`, `LogsPanel.tsx`
- Store actions: `apps/desktop/src/hooks/use-tasker-store.ts`
- E2E fixture: `apps/desktop/e2e/fixtures.ts`
- shadcn/ui Command docs: https://ui.shadcn.com/docs/components/command
- cmdk: https://github.com/pacocoursey/cmdk
