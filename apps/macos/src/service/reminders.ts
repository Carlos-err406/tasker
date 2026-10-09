import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  dueReminders,
  getAllTasks,
  getDeliveredReminders,
  getSettings,
  markRemindersDelivered,
  type Reminder,
  type TaskerDb,
} from "@tasker/core";

export type Notify = (reminder: Reminder) => Promise<void>;

/** Posts through SwiftBar's notify URL, so notifications appear as SwiftBar's. */
export const swiftBarNotify: Notify = async (reminder) => {
  const url = new URL("swiftbar://notify");
  url.searchParams.set("plugin", "Tasker");
  url.searchParams.set("title", reminder.title);
  url.searchParams.set(
    "body",
    reminder.time
      ? `${reminder.time} · ${reminder.listName}`
      : `Due today · ${reminder.listName}`,
  );
  // -g keeps SwiftBar in the background.
  await promisify(execFile)("/usr/bin/open", ["-g", url.toString()]);
};

/**
 * Checks for due reminders just after the start of every minute, since due times
 * are whole minutes. Rescheduling each minute keeps working across sleep and clock
 * changes, and late reminders are still delivered on wake.
 */
export function startReminders(options: {
  db: () => TaskerDb;
  notify: Notify;
  paused?: () => boolean;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      if (options.paused?.()) return;
      const db = options.db();
      if (!getSettings(db).notifications) return;
      const at = now();
      for (const reminder of dueReminders(
        getAllTasks(db),
        at,
        getDeliveredReminders(db),
      )) {
        try {
          await options.notify(reminder);
        } catch {
          continue; // Try again on the next check.
        }
        markRemindersDelivered(options.db(), [reminder.key], at);
      }
    } finally {
      running = false;
    }
  };
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(
      () => {
        void check();
        schedule();
      },
      60_000 - (Date.now() % 60_000) + 250,
    );
    timer.unref();
  };
  schedule();
  void check();
  return {
    check,
    close() {
      clearTimeout(timer);
    },
  };
}
