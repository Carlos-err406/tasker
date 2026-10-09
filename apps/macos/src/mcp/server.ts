import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Task } from "@tasker/core";
import { parseTaskDescription, formatTime } from "@tasker/core/parsers";
import type { ServiceClient } from "./client.js";

const STATUSES = ["pending", "in_progress", "done", "wont_do"] as const;
type Status = (typeof STATUSES)[number];
const PRIORITIES = { 1: "high", 2: "medium", 3: "low" } as const;
const ATTACHMENT = /\/attachments\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/g;

type TaskResult =
  | { type: "success" | "no-change" | "error"; message: string }
  | { type: "not-found"; taskId: string };

export const instructions = `Tasker is the user's personal task manager. Task IDs are 3 characters (e.g. "a1b").

A task's text is free markdown. Metadata goes on its own last line:
p1/p2/p3 priority (high/medium/low) · @date due (today, tomorrow, mon..sun, jan15, +3d, 2026-02-15), optionally followed by a time (@sat 6:30pm, @nov1 9am) · *interval repeat (*daily, *weekly, *monthly, *yearly, *3d, *2w, *2m; needs a due date) · #tag · ^abc parent task · !abc blocks task · -^abc has subtask · -!abc blocked by task · ~abc related task · >list-name create in / move to that list (removed on save).

Completing a repeating task (done or won't do) moves it to its next due date and back to pending instead; remove the *interval token to stop it.
Images in a task appear as ![name](/attachments/<id>); get_task returns them as images.
Search filters: tag:name status:pending|wip|done priority:high|medium|low due:today|overdue|week|month list:name has:subtasks|parent|due|tags id:abc; prefix a value with ! to negate; other words match the text.

Edits are undoable from the Tasker app and sync to the user's other devices.`;

function title(task: Task) {
  return task.description.split("\n").find((line) => line.trim())?.trim() ?? "";
}

function summary(task: Task) {
  const parsed = parseTaskDescription(task.description);
  return {
    id: task.id,
    title: title(task),
    list: task.listName,
    status: STATUSES[task.status],
    priority: task.priority ? PRIORITIES[task.priority] : null,
    due: task.dueDate,
    time: task.dueDate && parsed.dueTime ? formatTime(parsed.dueTime) : null,
    repeat: parsed.repeatRaw ? `*${parsed.repeatRaw}` : null,
    tags: task.tags ?? [],
    parent: task.parentId,
  };
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function outcome(result: TaskResult, id: string): CallToolResult {
  if (result.type === "not-found")
    return { isError: true, content: [{ type: "text", text: `No task with ID ${id}.` }] };
  return {
    isError: result.type === "error",
    content: [{ type: "text", text: result.message }],
  };
}

export function createMcpServer(client: ServiceClient, version: string) {
  const server = new McpServer({ name: "tasker", version }, { instructions });
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const id = z.string().describe("3-character task ID");

  server.registerTool(
    "list_lists",
    { description: "List the task lists, in the user's order, and which one is the default.", annotations: read },
    async () =>
      json({
        lists: await client.rpc<string[]>("lists:getAll"),
        default: await client.rpc<string>("lists:getDefault"),
      }),
  );

  const listName = z.string().trim().min(1);
  const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });
  /** Mirrors the app: the default list can't be renamed or deleted. */
  const changeableList = async (name: string) => {
    if (!(await client.rpc<string[]>("lists:getAll")).includes(name)) return `No list named "${name}".`;
    if (name === (await client.rpc<string>("lists:getDefault"))) return `"${name}" is the default list and can't be changed.`;
  };

  server.registerTool(
    "create_list",
    { description: "Create a task list.", inputSchema: { name: listName }, annotations: write },
    async ({ name }) => {
      if ((await client.rpc<string[]>("lists:getAll")).includes(name)) return failure(`A list named "${name}" already exists.`);
      return outcome(await client.rpc<TaskResult>("lists:create", name), name);
    },
  );

  server.registerTool(
    "rename_list",
    {
      description: "Rename a list; its tasks follow. The default list can't be renamed.",
      inputSchema: { name: listName, new_name: listName },
      annotations: write,
    },
    async ({ name, new_name }) => {
      const problem = await changeableList(name);
      if (problem) return failure(problem);
      if ((await client.rpc<string[]>("lists:getAll")).includes(new_name))
        return failure(`A list named "${new_name}" already exists.`);
      return outcome(await client.rpc<TaskResult>("lists:rename", name, new_name), name);
    },
  );

  server.registerTool(
    "delete_list",
    {
      description:
        "Delete a list together with every task in it, including its trashed tasks. The default list can't be deleted. The user can undo this in the Tasker app.",
      inputSchema: { name: listName },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ name }) => {
      const problem = await changeableList(name);
      if (problem) return failure(problem);
      const count = (await client.rpc<Task[]>("tasks:getAll", name)).length;
      const result = await client.rpc<TaskResult>("lists:delete", name);
      if (result.type !== "success") return outcome(result, name);
      return { content: [{ type: "text", text: `${result.message} and its ${count} ${count === 1 ? "task" : "tasks"}.` }] };
    },
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List tasks (not trashed) with their title, status and metadata. Use get_task for the full text and images.",
      inputSchema: {
        list: z.string().optional().describe("Only this list; omit for every list"),
        status: z.array(z.enum(STATUSES)).optional().describe("Only these statuses; omit for all"),
      },
      annotations: read,
    },
    async ({ list, status }) => {
      const tasks = await client.rpc<Task[]>("tasks:getAll", list);
      return json(
        tasks
          .map(summary)
          .filter((task) => !status || status.includes(task.status as Status)),
      );
    },
  );

  server.registerTool(
    "search_tasks",
    {
      description: "Search tasks with the app's search syntax (see instructions), e.g. `tag:bug status:!done login`.",
      inputSchema: { query: z.string() },
      annotations: read,
    },
    async ({ query }) => json((await client.rpc<Task[]>("tasks:search", query)).map(summary)),
  );

  server.registerTool(
    "get_task",
    {
      description: "Get a task's full text, metadata and subtasks, with its attached images.",
      inputSchema: { id },
      annotations: read,
    },
    async ({ id }) => {
      const task = await client.rpc<Task | null>("tasks:getById", id);
      if (!task) return { isError: true, content: [{ type: "text", text: `No task with ID ${id}.` }] };
      const all = await client.rpc<Task[]>("tasks:getAll");
      const result: CallToolResult = json({
        ...summary(task),
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        subtasks: all.filter((t) => t.parentId === task.id).map(summary),
        description: task.description,
      });
      const attachments = new Set([...task.description.matchAll(ATTACHMENT)].map((m) => m[1]!));
      for (const attachment of attachments) {
        try {
          const image = await client.image(attachment);
          result.content.push({ type: "image", data: image.data.toString("base64"), mimeType: image.mimeType });
        } catch (error) {
          result.content.push({ type: "text", text: `Image ${attachment} unavailable: ${(error as Error).message}` });
        }
      }
      return result;
    },
  );

  server.registerTool(
    "add_task",
    {
      description: "Create a task. The text may end with a metadata line (see instructions).",
      inputSchema: {
        text: z.string().min(1),
        list: z.string().optional().describe("Target list; defaults to the user's default list. A >list token in the text wins."),
      },
      annotations: write,
    },
    async ({ text, list }) => {
      const result = await client.rpc<{ task: Task; warnings: string[] }>(
        "tasks:add",
        text,
        list ?? (await client.rpc<string>("lists:getDefault")),
      );
      return json({ ...summary(result.task), warnings: result.warnings });
    },
  );

  server.registerTool(
    "edit_task",
    {
      description: "Replace a task's whole text, including its metadata line. Read it with get_task first and keep what should stay.",
      inputSchema: { id, text: z.string().min(1) },
      annotations: write,
    },
    async ({ id, text }) => outcome(await client.rpc<TaskResult>("tasks:rename", id, text), id),
  );

  server.registerTool(
    "set_task_status",
    {
      description: "Mark a task pending, in progress, done or won't do.",
      inputSchema: { id, status: z.enum(STATUSES) },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ id, status }) =>
      outcome(await client.rpc<TaskResult>("tasks:setStatus", id, STATUSES.indexOf(status)), id),
  );

  server.registerTool(
    "move_task",
    {
      description: "Move a task (and its subtasks) to another existing list.",
      inputSchema: { id, list: z.string() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ id, list }) => outcome(await client.rpc<TaskResult>("tasks:move", id, list), id),
  );

  server.registerTool(
    "delete_task",
    {
      description: "Move a task to the trash. Restore it with restore_task.",
      inputSchema: {
        id,
        include_subtasks: z.boolean().default(false).describe("Also trash its subtasks"),
      },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ id, include_subtasks }) =>
      outcome(await client.rpc<TaskResult>("tasks:delete", id, include_subtasks), id),
  );

  server.registerTool(
    "restore_task",
    {
      description: "Restore a task from the trash.",
      inputSchema: { id },
      annotations: write,
    },
    async ({ id }) => outcome(await client.rpc<TaskResult>("tasks:restore", id), id),
  );

  return server;
}
