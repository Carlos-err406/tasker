---
date: 2026-02-20
topic: command-panel
task: u4s
---

# Command Panel (VSCode-style)

## What We're Building

A VSCode-style command panel that replaces the current search bar entirely. A single overlay component handles two modes, toggled by a `>` prefix in the input — exactly like VSCode:

- **Task mode** (`Cmd+P`, no prefix): filterable list of all tasks. Selecting a task navigates to it.
- **Command mode** (`Cmd+Shift+P`, `>` prefix): filterable list of actions. Selecting a command executes it immediately or opens a second task-selection step.

The panel is a floating overlay (centered, modal-style), dismissed with Escape.

## Mode Switching

The input value controls the mode:
- No prefix → task search mode
- `>` prefix → command mode

`Cmd+P` opens the panel with empty input (task mode).
`Cmd+Shift+P` opens the panel with `>` pre-filled (command mode).
The user can switch modes manually by typing or removing `>`.

## Task Mode

Searches all tasks across all lists. Results show task name, list, status, and priority. Selecting a task closes the panel and navigates to it (expand its list + scroll + highlight) — same as the existing `navigateToTask()` store action.

The existing search bar is **kept** for persistent filtering (tag, status, priority, etc.). The command panel is purely additive — task mode is for ephemeral navigation only, not persistent filtering.

## Command Mode

### Immediate commands (single step)

| Command | Action |
|---------|--------|
| Undo / Redo | Dispatch undo/redo |
| Refresh | Reload data from DB |
| Apply system sort | `applySystemSort()` |
| Toggle help | Show/hide HelpPanel |
| Toggle logs | Show/hide LogsPanel |
| Collapse / Expand all lists | `toggleCollapseAll()` |
| Toggle hide completed — [List name] | Per-list `toggleHideCompleted()` |
| Toggle expand — [List name] | Per-list `toggleCollapsed()` |
| Decompose with AI — [task name] | Open decompose panel for that task (when LM Studio available) |

### Two-step commands (select command → select task)

After picking one of these, the panel transitions to task-search mode with a "Select task…" header:

| Command | After task selected |
|---------|---------------------|
| Edit task | Enter inline edit |
| Delete task | Delete with confirmation |
| Set status | Show status submenu (Pending / In Progress / Done) |
| Set priority | Show priority options (High / Medium / Low / None) |
| Set due date | Open date input |
| Move to list | Show list picker |
| Create subtask | Start add-input with `^taskId` pre-filled |

### List-targeting commands

| Command | After list selected |
|---------|---------------------|
| Add task to list | Start add-input in that list |
| Switch to list | Scroll/focus that list |

## Dependency

Use **shadcn/ui** (proper setup via `shadcn init`) with its Command component (backed by cmdk). The existing Radix + Tailwind setup is compatible; shadcn components will fit in naturally and opens the door to other shadcn components later.

The search bar (`SearchBar.tsx`) and its associated state (`searchQuery`, `SET_SEARCH`) can be removed.

## Key Decisions

- **One component, `>` prefix controls mode**: Matches VSCode muscle memory, simpler than two components
- **Search bar kept**: Command panel task mode is ephemeral navigation; search bar handles persistent filtering
- **Task selection navigates**: Consistent with existing `navigateToTask()` behaviour
- **Two-step for task-targeting commands**: No "focused task" assumption — user always picks the task explicitly after picking the command
- **shadcn/ui full setup**: Future-proof, cleaner than raw cmdk, consistent with the task description
- **Keyboard shortcut `Cmd+P` / `Cmd+Shift+P`**: Added to `useKeyboardShortcuts` hook

## Next Steps

→ `/workflows:plan` for implementation details
