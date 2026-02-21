---
date: 2026-02-20
topic: task-decomposition
task: xg1
parent: rjg (AI Features)
---

# Task Decomposition via LLM

## What We're Building

An AI-powered "decompose" feature that takes a task and generates a list of subtasks using an LLM. The user triggers it from the desktop via a context menu item, reviews and edits the proposed subtasks in a slide-in panel, then confirms to create them — all using the existing subtask infrastructure (`addTask` with `parentId`).

The feature degrades gracefully when LM Studio is offline: the menu item is always visible but disabled with a tooltip.

## Approach: Streaming XML

The LLM streams a response that may include reasoning prose followed by structured XML:

```xml
I'll break this down into concrete steps:

<tasks>
  <task>Research competitor APIs p2</task>
  <task>Draft schema design @2026-03-01</task>
  <task>Implement auth layer p1</task>
</tasks>
```

The renderer watches the stream for `<task>` tags appearing incrementally, rendering each one as it arrives using the existing task item UI. Prose outside the tags is shown in a "thinking" area above the task list. This format:
- Is streamable (no need to wait for the full response)
- Allows narrative commentary from the LLM
- Each `<task>` body is a full task description string — parsed by `TaskDescriptionParser` on creation, so inline metadata (priority, due date, tags) is fully supported

## UX Flow

1. User right-clicks a task → **"Decompose with AI"**
   - Menu item is disabled with tooltip `"LM Studio is not running"` when offline
2. Panel slides in (same pattern as HelpPanel/LogsPanel — `absolute inset-0`)
3. Panel shows: task name as header, a "thinking" area (streaming prose), then editable text inputs appearing one-by-one as `<task>` tags arrive
4. User can rename, delete individual rows, or add new rows
5. **Confirm** button: creates all remaining tasks as subtasks (via `addTask` with `parentId`)
6. **Cancel** button: closes panel, nothing created

## LLM Context Sent

The prompt includes:
- The task's full description (including inline metadata)
- Existing subtasks (to avoid duplicates)
- Parent task context (if this task is already a subtask)
- Explanation of the inline metadata format (`p1`/`p2`/`p3`, `@date`, `#tag`) so the LLM can suggest metadata in subtask names

## Key Decisions

- **XML over JSON**: Streamable, allows surrounding prose, familiar to LLMs
- **Desktop-only for now**: CLI can come later; context menu is the natural entry point
- **Disabled-with-tooltip when offline**: Always discoverable, clear feedback on why it's unavailable — uses `isLmStudioAvailable()` from `@tasker/core`, checked each time the context menu opens
- **Panel pattern**: Consistent with HelpPanel/LogsPanel — `absolute inset-0 z-40 bg-background/95`
- **Editable before confirm**: User can rename/delete/add rows before any task is created
- **Full metadata support**: Each `<task>` body goes through `TaskDescriptionParser`, so `p1`, `@date`, `#tag` work in generated names
- **No undo needed at trigger**: Creation goes through normal `addTask` flow, which is already undoable via the existing undo system
- **Works on tasks with existing subtasks**: Always available; LLM sees existing subtasks to avoid duplicates
- **No reordering in panel**: LLM order is kept; user can drag-and-drop in the main list after creation
- **Default model ID**: `"default"` — LM Studio's currently loaded model alias, zero config

## Next Steps

→ `/workflows:plan` for implementation details
