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
});
