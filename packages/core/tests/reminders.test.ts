import { describe, expect, it } from 'vitest';
import { dueReminders, reminderFor } from '../src/reminders.js';
import { createTestDb } from '../src/db-node.js';
import { getDeliveredReminders, markRemindersDelivered } from '../src/queries/settings-queries.js';
import type { Task } from '../src/types/task.js';

const task = (overrides: Partial<Task> & { description: string }): Task => ({
  id: 'abc',
  status: 0,
  createdAt: '2026-10-01T00:00:00Z',
  listName: 'tasks',
  dueDate: '2026-10-10',
  priority: null,
  tags: null,
  isTrashed: 0,
  sortOrder: 0,
  completedAt: null,
  parentId: null,
  ...overrides,
});
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

describe('reminders', () => {
  it('fire at the due time, or 9:00 for date-only tasks', () => {
    expect(reminderFor(task({ description: 'Watch Frieren\n@2026-10-10 6:30pm *weekly #anime' }))).toMatchObject({
      key: 'abc@2026-10-10T18:30',
      title: 'Watch Frieren',
      time: '6:30pm',
      at: at(10, 18, 30),
    });
    expect(reminderFor(task({ description: 'Pay rent\n@2026-10-10' }))).toMatchObject({
      key: 'abc@2026-10-10T09:00',
      time: null,
      at: at(10, 9),
    });
  });

  it('skip tasks without a date, finished, or trashed', () => {
    expect(reminderFor(task({ description: 'No date', dueDate: null }))).toBeNull();
    expect(reminderFor(task({ description: 'Done\n@2026-10-10', status: 2 }))).toBeNull();
    expect(reminderFor(task({ description: "Won't\n@2026-10-10", status: 3 }))).toBeNull();
    expect(reminderFor(task({ description: 'Trashed\n@2026-10-10', isTrashed: 1 }))).toBeNull();
    expect(reminderFor(task({ description: 'Busy\n@2026-10-10', status: 1 }))).not.toBeNull();
  });

  it('are due once reached, up to 12 hours late, and only until delivered', () => {
    const tasks = [
      task({ id: 'eve', description: 'Evening\n@2026-10-10 6:30pm' }),
      task({ id: 'mor', description: 'Morning\n@2026-10-10' }),
    ];
    expect(dueReminders(tasks, at(10, 8, 59), new Set())).toEqual([]);
    expect(dueReminders(tasks, at(10, 9), new Set()).map((r) => r.taskId)).toEqual(['mor']);
    expect(dueReminders(tasks, at(10, 19), new Set()).map((r) => r.taskId)).toEqual(['mor', 'eve']);
    expect(dueReminders(tasks, at(10, 19), new Set(['mor@2026-10-10T09:00'])).map((r) => r.taskId)).toEqual(['eve']);
    // 9:00 is more than 12 hours behind 21:01; the evening one still shows.
    expect(dueReminders(tasks, at(10, 21, 1), new Set()).map((r) => r.taskId)).toEqual(['eve']);
  });

  it('record deliveries per device and forget them after two days', () => {
    const db = createTestDb();
    markRemindersDelivered(db, ['a@2026-10-10T09:00'], at(10, 9));
    markRemindersDelivered(db, ['b@2026-10-12T09:00'], at(11, 9));
    expect([...getDeliveredReminders(db)]).toEqual(['a@2026-10-10T09:00', 'b@2026-10-12T09:00']);
    markRemindersDelivered(db, ['c@2026-10-13T09:00'], at(13, 9));
    expect([...getDeliveredReminders(db)]).toEqual(['b@2026-10-12T09:00', 'c@2026-10-13T09:00']);
  });
});
