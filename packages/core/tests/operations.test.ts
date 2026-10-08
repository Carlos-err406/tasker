import { describe, expect, it } from "vitest";
import { createTestDb } from "../src/db-node.js";
import { UndoManager } from "../src/undo/index.js";
import { createRegistry } from "../src/operations/registry.js";

describe("portable task operations", () => {
  it("shares validation, metadata, lists, undo and redo across hosts", async () => {
    const db = createTestDb();
    const registry = createRegistry(db, new UndoManager(db));
    await expect(registry.invoke("tasks:add", ["", "tasks"])).rejects.toThrow(
      "Invalid arguments",
    );
    await expect(registry.invoke("tasker:resetForTest", [])).rejects.toThrow(
      "Invalid operation",
    );
    expect((await registry.invoke("lists:create", ["phone"]))[0]).toBeNull();
    const [error, result] = await registry.invoke("tasks:add", [
      "Buy milk\n#errands p1",
      "phone",
    ]);
    expect(error).toBeNull();
    expect(result.task.tags).toContain("errands");
    const id = result.task.id;
    await registry.invoke("tasks:setStatus", [id, 2]);
    expect((await registry.invoke("tasks:getById", [id]))[1].status).toBe(2);
    await registry.invoke("undo:undo", []);
    expect((await registry.invoke("tasks:getById", [id]))[1].status).toBe(0);
    await registry.invoke("undo:redo", []);
    expect((await registry.invoke("tasks:getById", [id]))[1].status).toBe(2);
  });

  it("deleting the whole metadata line in the editor clears it, and undo restores it", async () => {
    const db = createTestDb();
    const registry = createRegistry(db, new UndoManager(db));
    const a = (await registry.invoke("tasks:add", ["cant delete metadata", "tasks"]))[1].task.id;
    const b = (await registry.invoke("tasks:add", ["overgeared", "tasks"]))[1].task.id;
    const body = "overgeared\n- [x] 1 https://example.com/1\n- [x] 2 https://example.com/2";
    await registry.invoke("tasks:rename", [b, `${body}\n~${a} #domingo #anime`]);
    const get = async (id: string) => (await registry.invoke("tasks:getById", [id]))[1];
    expect((await get(a)).description).toContain(`~${b}`);

    // The editor sends the full text with the metadata line removed.
    await registry.invoke("tasks:rename", [b, body]);
    expect((await get(b)).description).toBe(body);
    expect((await get(b)).tags).toBeNull();
    // The relationship is gone from both tasks.
    expect((await get(a)).description).toBe("cant delete metadata");

    await registry.invoke("undo:undo", []);
    expect((await get(b)).description).toBe(`${body}\n~${a} #domingo #anime`);
    expect((await get(a)).description).toContain(`~${b}`);
    await registry.invoke("undo:redo", []);
    expect((await get(b)).description).toBe(body);
  });

  it("undoing an edit that added metadata removes it again", async () => {
    const db = createTestDb();
    const registry = createRegistry(db, new UndoManager(db));
    const id = (await registry.invoke("tasks:add", ["plain", "tasks"]))[1].task.id;
    await registry.invoke("tasks:rename", [id, "plain\np1 #later"]);
    await registry.invoke("undo:undo", []);
    const task = (await registry.invoke("tasks:getById", [id]))[1];
    expect(task.description).toBe("plain");
    expect(task.tags).toBeNull();
    expect(task.priority).toBeNull();
  });

  it("keeps a device-local All lists order that drags, sorts and undoes independently of list order", async () => {
    const db = createTestDb();
    const registry = createRegistry(db, new UndoManager(db));
    await registry.invoke("lists:create", ["work"]);
    const add = async (text: string, list: string) =>
      (await registry.invoke("tasks:add", [text, list]))[1].task.id as string;
    const low = await add("low\np3", "tasks");
    const plain = await add("plain", "work");
    const high = await add("high\np1", "work");
    const order = async () => (await registry.invoke("tasks:getAllListsOrder", []))[1] as string[];
    const listOrder = async (list: string) =>
      ((await registry.invoke("tasks:getAll", [list]))[1] as { id: string }[]).map((t) => t.id);

    // Without a saved order, All starts in system order.
    expect(await order()).toEqual([high, plain, low]);
    const workBefore = await listOrder("work");

    // Dragging in All changes only the All order.
    await registry.invoke("tasks:reorderAllLists", [low, 0]);
    expect(await order()).toEqual([low, high, plain]);
    expect(await listOrder("work")).toEqual(workBefore);

    // New tasks appear at the top of All.
    const fresh = await add("fresh", "work");
    expect(await order()).toEqual([fresh, low, high, plain]);

    // Undo/redo replay the All reorder.
    await registry.invoke("undo:undo", []); // undo the add
    await registry.invoke("undo:undo", []); // undo the All reorder
    expect((await order()).filter((id) => id !== fresh)).toEqual([high, plain, low]);
    await registry.invoke("undo:redo", []);
    expect((await order()).filter((id) => id !== fresh)).toEqual([low, high, plain]);

    // System sort in All restores system order without touching the lists.
    const workNow = await listOrder("work");
    await registry.invoke("tasks:applySystemSortAllLists", []);
    expect((await order()).filter((id) => id !== fresh)).toEqual([high, plain, low]);
    expect(await listOrder("work")).toEqual(workNow);
  });
});
