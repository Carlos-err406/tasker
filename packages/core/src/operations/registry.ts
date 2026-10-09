import { withTransaction } from "../db.js";
import type { TaskerDb } from "../db.js";
import type { UndoManager } from "../undo/index.js";
import { tasksRegister } from "./handlers/tasks.js";
import { listsRegister } from "./handlers/lists.js";
import { undoRegister } from "./handlers/undo.js";
import { settingsRegister, autoSort } from "./handlers/settings.js";
import { isSettingKey } from "../queries/settings-queries.js";
import type { SyncStore } from "../sync/store.js";
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
  "tasks:getAllListsOrder": [],
  "tasks:reorderAllLists": [id, index],
  "tasks:applySystemSortAllLists": [],
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
  "settings:get": [],
  "settings:set": [isSettingKey, bool],
};
export function createRegistry(
  db: TaskerDb,
  undo: UndoManager,
  sync?: SyncStore,
) {
  const handlers = new Map<string, Handler>();
  const registry = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler);
    },
  };
  for (const register of [tasksRegister, listsRegister, undoRegister, settingsRegister])
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
      const handler = handlers.get(channel)!;
      const mutation =
        !/^(tasks:(get|search)|lists:(get|is|setCollapsed|setHideCompleted)|undo:(can|reload)|settings:)/.test(
          channel,
        );
      if (mutation || channel.startsWith("undo:")) undo.reloadHistory();
      if (!mutation) return handler(null, ...args);
      const command =
        channel === "undo:undo"
          ? undo.undoHistory[0]
          : channel === "undo:redo"
            ? undo.redoHistory[0]
            : undefined;
      try {
        return withTransaction(db, () => {
          const result = handler(null, ...args) as any;
          if (result instanceof Promise)
            throw new Error("Task mutations must be synchronous");
          if (Array.isArray(result) && result[0])
            throw new Error(result[0].message);
          autoSort(db);
          if (sync) {
            if (channel === "lists:rename")
              sync.renameList(args[0] as string, args[1] as string);
            if (command?.$type === "renameList")
              sync.renameList(
                channel === "undo:undo" ? command.newName : command.oldName,
                channel === "undo:undo" ? command.oldName : command.newName,
              );
            sync.capture(false, channel.startsWith("undo:"));
          }
          return result;
        });
      } catch (error) {
        undo.cancelBatch();
        undo.reloadHistory();
        return [
          { message: error instanceof Error ? error.message : String(error) },
          null,
        ];
      }
    },
  };
}
