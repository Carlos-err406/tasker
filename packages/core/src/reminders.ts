/**
 * Due-time reminders: which occurrences should notify now. Pure, so every host
 * (the Mac service, the Android scheduler) applies the same rules.
 */

import type { Task } from './types/task.js';
import { TaskStatus } from './types/task-status.js';
import { parse as parseDescription, getDisplayDescription } from './parsers/task-description-parser.js';
import { formatTime } from './parsers/recurrence.js';

/** Date-only tasks remind at this time on their due date. */
export const DEFAULT_REMINDER_TIME = '09:00';
/** Reminders missed while the device slept are still shown up to this late. */
export const MAX_LATENESS_MS = 12 * 60 * 60 * 1000;

export interface Reminder {
  /** Identifies one occurrence: editing the date or time makes a new one. */
  key: string;
  taskId: string;
  title: string;
  listName: string;
  /** When it is due, as a local Date. */
  at: Date;
  /** e.g. "6:30pm", or null for a date-only task. */
  time: string | null;
}

/** The reminder for a task's current occurrence, or null if it has nothing to remind. */
export function reminderFor(task: Task): Reminder | null {
  if (!task.dueDate || task.isTrashed) return null;
  if (task.status !== TaskStatus.Pending && task.status !== TaskStatus.InProgress) return null;
  const time = parseDescription(task.description).dueTime;
  const [y, m, d] = task.dueDate.split('-').map(Number) as [number, number, number];
  const [h, min] = (time ?? DEFAULT_REMINDER_TIME).split(':').map(Number) as [number, number];
  const title = getDisplayDescription(task.description).split('\n').find((line) => line.trim())?.trim() ?? task.id;
  return {
    key: `${task.id}@${task.dueDate}T${time ?? DEFAULT_REMINDER_TIME}`,
    taskId: task.id,
    title,
    listName: task.listName,
    at: new Date(y, m - 1, d, h, min),
    time: time ? formatTime(time) : null,
  };
}

/** Reminders due at `now` that haven't been delivered and are at most 12 hours late. */
export function dueReminders(tasks: readonly Task[], now: Date, delivered: ReadonlySet<string>): Reminder[] {
  return tasks
    .map(reminderFor)
    .filter((r): r is Reminder => !!r && r.at <= now && now.getTime() - r.at.getTime() <= MAX_LATENESS_MS && !delivered.has(r.key))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
