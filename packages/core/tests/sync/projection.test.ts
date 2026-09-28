import { describe, expect, it } from "vitest";
import {
  canonical,
  DEFAULT_LIST_ID,
  projectRecords,
  type SyncRecord,
  type SyncTask,
} from "../../src/sync/index.js";
const task = (
  id: string,
  patch: Partial<SyncTask> = {},
  time = 1,
): SyncRecord => ({
  kind: "task",
  id,
  revision: { time, counter: 0, actor: "a" },
  value: {
    preferredId: "abc",
    description: "Task",
    createdAt: "2026-09-28T00:00:00Z",
    status: 0,
    listId: DEFAULT_LIST_ID,
    dueDate: null,
    priority: null,
    tags: null,
    isTrashed: 0,
    sortOrder: 0,
    completedAt: null,
    parentId: null,
    ...patch,
  },
});
const edge = (from: string, to: string, time = 1): SyncRecord => ({
  kind: "dependency",
  id: canonical([from, to]),
  revision: { time, counter: 0, actor: "a" },
  value: { from, to },
});
describe("sync projection", () => {
  it("preserves colliding tasks and translates relationship markers without rewriting prose", () => {
    const rows = [
      task("a"),
      task("b", {
        description: "Prose ^abc and https://example.com/abc\n^abc",
        parentId: "a",
      }),
      task("c", { preferredId: "def" }),
    ];
    const result = projectRecords(rows);
    expect(new Set(result.tasks.map((t) => t.id)).size).toBe(3);
    expect(result.tasks.find((t) => t.syncId === "b")?.description).toBe(
      "Prose ^abc and https://example.com/abc\n^abc",
    );
    expect(result.tasks.find((t) => t.syncId === "a")?.description).toContain(
      "-^" + result.tasks.find((t) => t.syncId === "b")!.id,
    );
    expect(result.tasks.find((t) => t.syncId === "c")?.id).toBe("def");
    expect(projectRecords([...rows].reverse())).toEqual(result);
  });
  it("deterministically suppresses cycles, missing endpoints, and cross-list parents", () => {
    const rows = [
      task("a", { parentId: "b" }),
      task("b", { parentId: "a" }, 2),
      edge("a", "b", 2),
      edge("b", "a"),
      edge("a", "gone"),
    ];
    const result = projectRecords(rows);
    expect(result.tasks.filter((t) => t.parentId)).toHaveLength(1);
    expect(result.dependencies).toHaveLength(1);
    expect(projectRecords([...rows].reverse())).toEqual(result);
  });
  it("preserves tasks from deleted lists in the default list and drops stale inverse markers", () => {
    const result = projectRecords([
      task("a", { listId: "gone", description: "Keep me\n-^old !old" }),
    ]);
    expect(result.tasks[0]?.listName).toBe("tasks");
    expect(result.tasks[0]?.description).toBe("Keep me");
  });
  it("retains same-name lists with deterministic unique names", () => {
    const lists: SyncRecord[] = ["a", "b", "c"].map((id) => ({
      kind: "list",
      id,
      revision: { time: 1, counter: 0, actor: "x" },
      value: { name: id === "c" ? "Books (2)" : "Books", sortOrder: 0 },
    }));
    expect(projectRecords(lists).lists.map((l) => l.name)).toEqual([
      "Books",
      "Books (3)",
      "Books (2)",
      "tasks",
    ]);
  });
});
