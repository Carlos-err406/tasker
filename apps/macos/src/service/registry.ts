import type { TaskerDb, UndoManager } from "@tasker/core";
import { tasksRegister } from "./handlers/tasks.js";
import { listsRegister } from "./handlers/lists.js";
import { undoRegister } from "./handlers/undo.js";
type Handler = (event: unknown, ...args: any[]) => unknown;
export type IPCRegisterFunction = (
  registry: { handle(channel: string, handler: Handler): void },
  widget: null,
  context: { db: TaskerDb; undo: UndoManager },
) => void;
type Check = (value: unknown) => boolean;
const text: Check = (v) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 100000;
const name: Check = (v) => text(v) && (v as string).length <= 200;
const id: Check = (v) => typeof v === "string" && /^[a-z0-9]{3}$/.test(v);
const bool: Check = (v) => typeof v === "boolean";
const index: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const status: Check = (v) => [0, 1, 2, 3].includes(v as number);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || v === null || check(v);
const ids: Check = (v) => Array.isArray(v) && v.length <= 1000 && v.every(id);
const schemas: Record<string, Check[]> = {
  "tasks:getAll": [optional(name)],
  "tasks:getById": [id],
  "tasks:search": [text],
  "tasks:add": [text, name],
  "tasks:setStatus": [id, status],
  "tasks:rename": [id, text],
  "tasks:delete": [id, optional(bool)],
  "tasks:move": [id, name],
  "tasks:reorder": [id, index],
  "tasks:setDueDate": [
    id,
    (v) =>
      v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)),
  ],
  "tasks:setPriority": [
    id,
    (v) => v === null || [1, 2, 3].includes(v as number),
  ],
  "tasks:getStats": [optional(name)],
  "tasks:restore": [id],
  "tasks:getRelCounts": [ids],
  "tasks:getTitles": [ids],
  "tasks:applySystemSort": [optional(name)],
  "tasks:softDeleteByStatus": [status, optional(name)],
  "tasks:softDeleteOlderThan": [text, optional(name)],
  "tasks:getTrash": [optional(name)],
  "tasks:clearTrash": [optional(name)],
  "lists:getAll": [],
  "lists:create": [name],
  "lists:delete": [name],
  "lists:rename": [name, name],
  "lists:reorder": [name, index],
  "lists:isCollapsed": [name],
  "lists:setCollapsed": [name, bool],
  "lists:isHideCompleted": [name],
  "lists:setHideCompleted": [name, bool],
  "lists:getDefault": [],
  "undo:undo": [],
  "undo:redo": [],
  "undo:canUndo": [],
  "undo:canRedo": [],
  "undo:reload": [],
};
export function createRegistry(db: TaskerDb, undo: UndoManager) {
  const handlers = new Map<string, Handler>();
  const registry = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler);
    },
  };
  for (const register of [tasksRegister, listsRegister, undoRegister])
    register(registry, null, { db, undo });
  return {
    async invoke(channel: unknown, args: unknown) {
      if (
        typeof channel !== "string" ||
        !Object.hasOwn(schemas, channel) ||
        !Array.isArray(args)
      )
        throw new Error("Invalid operation");
      const schema = schemas[channel]!;
      if (
        args.length > schema.length ||
        !schema.every((check, i) => check(args[i]))
      )
        throw new Error("Invalid arguments");
      return handlers.get(channel)!(null, ...args);
    },
  };
}
