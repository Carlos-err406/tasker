import { expect, it } from "vitest";
import type { Task } from "@tasker/core/types";
import { upcomingReminders } from "../src/reminders";

const task = (id: string, description: string, overrides: Partial<Task> = {}): Task => ({
  id,
  description,
  status: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  listName: "tasks",
  dueDate: null,
  priority: null,
  tags: null,
  isTrashed: 0,
  sortOrder: 0,
  completedAt: null,
  parentId: null,
  ...overrides,
});

it("schedules open tasks' occurrences, soonest first, dropping ones over 12 hours late", () => {
  const now = new Date(2026, 9, 20, 14, 0);
  const reminders = upcomingReminders(
    [
      task("tsk_later", "Dentist\n@2026-10-21 9am", { dueDate: "2026-10-21" }),
      task("tsk_today", "Water plants\n@2026-10-20 6pm", { dueDate: "2026-10-20" }),
      task("tsk_morning", "Pay rent\n@2026-10-20", { dueDate: "2026-10-20", listName: "home" }),
      task("tsk_stale", "Old\n@2026-10-19 1am", { dueDate: "2026-10-19" }),
      task("tsk_done", "Done\n@2026-10-20 8pm", { dueDate: "2026-10-20", status: 2 }),
      task("tsk_nodate", "Someday"),
    ],
    now,
  );
  expect(reminders.map((r) => [r.taskId, r.time, r.list])).toEqual([
    ["tsk_morning", null, "home"],
    ["tsk_today", "6pm", "tasks"],
    ["tsk_later", "9am", "tasks"],
  ]);
  expect(reminders[0]).toMatchObject({
    key: "tsk_morning@2026-10-20T09:00",
    title: "Pay rent",
    at: new Date(2026, 9, 20, 9, 0).getTime(),
  });
});
