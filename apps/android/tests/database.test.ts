import { afterEach, describe, expect, it } from "vitest";
import { createDb, getRawDb } from "@tasker/core/db-node";
import {
  addTask,
  createList,
  getAllTasks,
  renameList,
  getAllListNames,
} from "@tasker/core/queries";
import { UndoManager } from "@tasker/core/undo";
import { createRegistry } from "@tasker/core/operations";
import {
  createAndroidDatabase,
  callNative,
  type AndroidBridge,
} from "../src/database";

const clients: ReturnType<typeof getRawDb>[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});
function fixture() {
  const client = getRawDb(createDb(":memory:"));
  clients.push(client);
  const bridge: AndroidBridge = {
    openExternal() {},
    execute(request) {
      try {
        const { action, sql, params } = JSON.parse(request);
        let result: unknown;
        if (action === "query") {
          const statement = client.prepare(sql);
          result = {
            columns: statement.columns().map((c) => c.name),
            rows: statement.raw().all(...params),
          };
        } else if (action === "run")
          result = client.prepare(sql).run(...params);
        else if (["begin", "commit", "rollback"].includes(action)) {
          client.exec(action);
          result = true;
        } else throw new Error("Unknown action");
        return JSON.stringify({ result });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    },
  };
  return { db: createAndroidDatabase(bridge), bridge, client };
}

describe("Android SQLite session", () => {
  it("runs shared queries, joins, metadata search, status and persisted undo through the native protocol", async () => {
    const { db, bridge } = fixture();
    const registry = createRegistry(db, new UndoManager(db)) as {
      invoke(channel: string, args: unknown[]): Promise<[unknown, any]>;
    };
    await registry.invoke("lists:create", ["phone"]);
    const [error, result] = await registry.invoke("tasks:add", [
      "Android task\n#phone p1 @tomorrow",
      "phone",
    ]);
    expect(error).toBeNull();
    expect(result.task.tags).toEqual(["phone"]);
    expect(result.task.priority).toBe(1);
    expect((await registry.invoke("tasks:search", ["#phone"]))[1]).toHaveLength(
      1,
    );
    const id = result.task.id;
    await registry.invoke("tasks:setStatus", [id, 2]);
    const reopenedDb = createAndroidDatabase(bridge);
    const reopened = createRegistry(reopenedDb, new UndoManager(reopenedDb)) as typeof registry;
    expect((await reopened.invoke("tasks:getById", [id]))[1].status).toBe(2);
    expect((await reopened.invoke("undo:undo", []))[0]).toBeNull();
    expect((await reopened.invoke("tasks:getById", [id]))[1].status).toBe(0);
    await reopened.invoke("tasks:delete", [id]);
    expect((await reopened.invoke("tasks:getTrash", []))[1]).toHaveLength(1);
    await reopened.invoke("tasks:restore", [id]);
    expect(getAllTasks(db)).toHaveLength(1);
  });
  it("rolls back failed transactions and preserves stable order and list cascades", () => {
    const { db } = fixture();
    createList(db, "phone");
    const first = addTask(db, "First", "phone").task;
    addTask(db, "Second", "phone");
    expect(() =>
      db.transaction((tx) => {
        createList(tx, "doomed");
        throw new Error("cancel");
      }),
    ).toThrow("cancel");
    expect(getAllListNames(db)).not.toContain("doomed");
    renameList(db, "phone", "mobile");
    expect(getAllTasks(db, "mobile").map((t) => t.description)).toEqual([
      "Second",
      "First",
    ]);
    expect(getAllTasks(db, "mobile")[1]?.id).toBe(first.id);
  });
  it("propagates native failures instead of reporting successful saves", () => {
    const { bridge } = fixture();
    expect(() =>
      callNative(bridge, "run", {
        sql: "INSERT INTO missing VALUES (?)",
        params: ["x"],
      }),
    ).toThrow();
  });
});

it("reloads restored undo history before the next undo action", async () => {
  const { db, client } = fixture();
  const registry = createRegistry(db, new UndoManager(db));
  await registry.invoke("tasks:add", ["Before snapshot", "tasks"]);
  // Use the native protocol to model restoring a snapshot without undo history.
  client.exec("DELETE FROM undo_history");
  await registry.invoke("undo:reload", []);
  expect(await registry.invoke("undo:canUndo", [])).toEqual([null, false]);
  expect(await registry.invoke("undo:undo", [])).toEqual([null, null]);
  expect(getAllTasks(db).map((task) => task.description)).toEqual([
    "Before snapshot",
  ]);
});
