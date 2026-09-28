import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "../../src/db-node.js";
import { SyncStore, canonical } from "../../src/sync/index.js";
import { UndoManager } from "../../src/undo/index.js";
import { createRegistry } from "../../src/operations/registry.js";
function device(replica: string, now = 10000000000000) {
  const db = createTestDb(),
    store = new SyncStore(db, replica, randomUUID, () => now),
    undo = new UndoManager(db);
  return { db, store, undo, registry: createRegistry(db, undo, store) };
}
describe("durable sync capture", () => {
  it("captures registry writes and propagates independent tasks and later edits", async () => {
    const a = device("a"),
      b = device("b");
    const [, first] = (await a.registry.invoke("tasks:add", [
      "Mac task",
      "tasks",
    ])) as any;
    const [, second] = (await b.registry.invoke("tasks:add", [
      "Phone task",
      "tasks",
    ])) as any;
    a.store.apply(b.store.records());
    b.store.apply(a.store.records());
    expect(a.store.records()).toEqual(b.store.records());
    expect(
      a.db.all(sql`SELECT description FROM tasks ORDER BY description`),
    ).toEqual([{ description: "Mac task" }, { description: "Phone task" }]);
    await b.registry.invoke("tasks:rename", [first.task.id, "Edited on phone"]);
    a.store.apply(b.store.records());
    expect(
      a.db.get<{ description: string }>(
        sql`SELECT description FROM tasks WHERE id=${first.task.id}`,
      )?.description,
    ).toBe("Edited on phone");
    expect(second.task.id).toBeTruthy();
  });
  it("preserves list identity over rename, undo, and redo", async () => {
    const a = device("a");
    await a.registry.invoke("lists:create", ["Books"]);
    const id = a.store
      .records()
      .find((r) => r.kind === "list" && r.value?.name === "Books")!.id;
    await a.registry.invoke("lists:rename", ["Books", "Reading"]);
    expect(a.store.records().find((r) => r.id === id)?.value).toMatchObject({
      name: "Reading",
    });
    await a.registry.invoke("undo:undo", []);
    expect(a.store.records().find((r) => r.id === id)?.value).toMatchObject({
      name: "Books",
    });
    await a.registry.invoke("undo:redo", []);
    expect(a.store.records().find((r) => r.id === id)?.value).toMatchObject({
      name: "Reading",
    });
  });
  it("persists tombstones, keeps undo for no-op polls, and clears it for changed remote data", async () => {
    const a = device("a"),
      b = device("b");
    const [, created] = (await a.registry.invoke("tasks:add", [
      "Delete me",
      "tasks",
    ])) as any;
    b.store.apply(a.store.records());
    expect(a.undo.canUndo).toBe(true);
    expect(a.store.apply(b.store.records())).toBe(false);
    expect(a.db.all(sql`SELECT * FROM undo_history`)).not.toHaveLength(0);
    await a.registry.invoke("tasks:delete", [created.task.id]);
    await a.registry.invoke("tasks:clearTrash", []);
    b.store.apply(a.store.records());
    expect(b.db.all(sql`SELECT * FROM tasks`)).toEqual([]);
    expect(b.store.records().find((r) => r.kind === "task")?.value).toBeNull();
  });
  it("rolls back both task data and undo state if capture fails", async () => {
    const a = device("a");
    const before = canonical(a.store.records());
    a.store.capture = () => {
      throw new Error("Disk full");
    };
    const [error] = (await a.registry.invoke("tasks:add", [
      "Never committed",
      "tasks",
    ])) as any;
    expect(error.message).toBe("Disk full");
    expect(a.db.all(sql`SELECT * FROM tasks`)).toEqual([]);
    expect(a.db.all(sql`SELECT * FROM undo_history`)).toEqual([]);
    expect(a.undo.canUndo).toBe(false);
    expect(canonical(a.store.records())).toBe(before);
  });
  it("gives a recreated list a new identity and preserves the deletion record", async () => {
    const a = device("a");
    await a.registry.invoke("lists:create", ["Books"]);
    const id = a.store
      .records()
      .find((r) => r.kind === "list" && r.value?.name === "Books")!.id;
    await a.registry.invoke("lists:delete", ["Books"]);
    await a.registry.invoke("lists:create", ["Books"]);
    expect(a.store.records().find((r) => r.id === id)?.value).toBeNull();
    expect(
      a.store
        .records()
        .find((r) => r.kind === "list" && r.value?.name === "Books")?.id,
    ).not.toBe(id);
  });
  it("keeps existing local task IDs stable when an incoming task claims the same short ID", async () => {
    const a = device("a"),
      b = device("b");
    const [, created] = (await a.registry.invoke("tasks:add", [
      "Existing",
      "tasks",
    ])) as any;
    const incoming = structuredClone(
      a.store.records().find((r) => r.kind === "task")!,
    );
    incoming.id = "000-earlier-identity";
    if (incoming.kind === "task" && incoming.value)
      incoming.value.description = "Incoming collision";
    a.store.apply([incoming]);
    expect(
      a.db.get<{ description: string }>(
        sql`SELECT description FROM tasks WHERE id=${created.task.id}`,
      )?.description,
    ).toBe("Existing");
    b.store.apply(a.store.records());
    expect(b.store.records()).toEqual(a.store.records());
    expect(a.db.all(sql`SELECT id FROM tasks`)).toHaveLength(2);
  });
  it("reconciles an old restored snapshot as fresh changes without reusing the publishing replica", async () => {
    const a = device("before");
    const [, created] = (await a.registry.invoke("tasks:add", [
      "Old text",
      "tasks",
    ])) as any;
    await a.registry.invoke("tasks:rename", [created.task.id, "New text"]);
    const prior = a.store.exportRestoreBaseline();
    const identity = a.store.taskIdentity(created.task.id);
    a.db.run(sql`UPDATE tasks SET description='Old text'`);
    for (const name of ["sync_records", "sync_aliases", "sync_meta"])
      a.db.run(sql.raw("DROP TABLE " + name));
    const restored = new SyncStore(
      a.db,
      "after",
      randomUUID,
      () => 10000000000001,
    );
    restored.rebaseAfterRestore(prior);
    expect(restored.taskIdentity(created.task.id)).toBe(identity);
    const task = restored.records().find((r) => r.kind === "task")!;
    expect(task.value).toMatchObject({ description: "Old text" });
    expect(task.revision.actor).toBe("after");
    expect(restored.getMeta("dirty")).toBe("1");
  });
});
