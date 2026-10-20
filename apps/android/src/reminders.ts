import { MAX_LATENESS_MS, reminderFor } from "@tasker/core/reminders";
import type { Task } from "@tasker/core/types";

export interface ScheduledReminder {
  key: string;
  taskId: string;
  title: string;
  list: string;
  /** Epoch milliseconds. */
  at: number;
  /** e.g. "6:30pm", or null for a date-only task (reminded at 9:00). */
  time: string | null;
}

/**
 * Reminders for native code to schedule: every open task's current occurrence that
 * isn't more than 12 hours late, soonest first. Native code delivers each key once.
 */
export function upcomingReminders(
  tasks: readonly Task[],
  now: Date,
): ScheduledReminder[] {
  return tasks
    .flatMap((task) => {
      const r = reminderFor(task);
      return r && now.getTime() - r.at.getTime() <= MAX_LATENESS_MS
        ? [
            {
              key: r.key,
              taskId: r.taskId,
              title: r.title,
              list: r.listName,
              at: r.at.getTime(),
              time: r.time,
            },
          ]
        : [];
    })
    .sort((a, b) => a.at - b.at);
}
