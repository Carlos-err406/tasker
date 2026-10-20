import { connectAndroidSync, androidSync } from "./sync";
import { widgetImages, widgetNotes } from "./widget";
import { upcomingReminders } from "./reminders";
import { configureHost } from "@tasker/ui/host";
import { tasksInvokerFactory } from "@tasker/ui/transport/tasks/preload";
import { listsInvokerFactory } from "@tasker/ui/transport/lists/preload";
import { undoInvokerFactory } from "@tasker/ui/transport/undo/preload";
import { settingsInvokerFactory } from "@tasker/ui/transport/settings/preload";
import { UndoManager } from "@tasker/core/undo";
import { createRegistry } from "@tasker/core/operations";
import { addDays, formatDate, formatTime, parseTaskDescription } from "@tasker/core/parsers";
import type { Task } from "@tasker/core/types";
import {
  getDescriptionPreview,
  getDisplayTitle,
  getTagColor,
  TAG_COLORS,
  withMetadata,
} from "@tasker/ui";
import {
  callNative,
  createAndroidDatabase,
  type AndroidBridge,
} from "./database";

declare global {
  interface Window {
    TaskerNative?: AndroidBridge;
    taskerBack?: () => boolean;
    taskerShortcut?: () => void;
    taskerWidgetSnapshot?: () => void;
    taskerNotificationAction?: (json: string) => Promise<void>;
  }
}
/**
 * `hidden`: a page without UI that native code starts to run a reminder button's
 * action while Tasker is closed. It records the change for the next sync instead of syncing.
 */
export function connectAndroidHost({ hidden = false } = {}) {
  const bridge = window.TaskerNative;
  if (!bridge) throw new Error("Open this app from Tasker on Android.");
  const db = createAndroidDatabase(bridge);
  connectAndroidSync(db, bridge, !hidden);
  let registry = createRegistry(db, new UndoManager(db), androidSync().store);
  window.addEventListener("tasker:sync-reset", () => {
    registry = createRegistry(db, new UndoManager(db), androidSync().store);
  });
  // The home-screen widget draws this snapshot. Native asks for it whenever the app
  // leaves the foreground; a sync that lands afterwards refreshes it too.
  const get = async <T>(channel: string, args: unknown[] = []) => {
    const [error, value] = (await registry.invoke(channel, args)) as
      | [null, T]
      | [{ message: string }, null];
    if (error) throw new Error(error.message);
    return value as T;
  };
  const writeWidgetSnapshot = () =>
    Promise.all([
      get<string[]>("lists:getAll"),
      get<Task[]>("tasks:getAll"),
      get<string[]>("tasks:getAllListsOrder"),
    ])
      .then(([lists, tasks, allOrder]) => {
        const open = tasks.filter((t) => t.status === 0 || t.status === 1);
        const known = new Set(allOrder);
        const titles = new Map(tasks.map((t) => [t.id, getDisplayTitle(t)]));
        bridge.widgetSnapshot?.(
          JSON.stringify({
            lists,
            // Each list's own order; All lists puts unsaved (new) tasks first, like the app.
            tasks: open.map((t) => {
              const parsed = parseTaskDescription(t.description);
              const named = (ids: string[] | null) =>
                (ids ?? []).flatMap((id) => titles.get(id) ?? []);
              return {
                id: t.id,
                list: t.listName,
                title: getDisplayTitle(t),
                notes: widgetNotes(getDescriptionPreview(t)),
                images: widgetImages(t.description),
                status: t.status,
                priority: t.priority,
                due: t.dueDate,
                time: t.dueDate && parsed.dueTime ? formatTime(parsed.dueTime) : null,
                repeats: !!(t.dueDate && parsed.repeat),
                parent: (t.parentId && titles.get(t.parentId)) || null,
                subtasks: parsed.hasSubtaskIds?.length ?? 0,
                blockedBy: named(parsed.blockedByIds),
                blocks: named(parsed.blocksIds),
                related: named(parsed.relatedIds),
                // Index into the app's tag palette, so each tag keeps its color.
                tags: (t.tags ?? []).map((name) => ({
                  name,
                  color: TAG_COLORS.indexOf(getTagColor(name)),
                })),
              };
            }),
            allOrder: [
              ...open.filter((t) => !known.has(t.id)).map((t) => t.id),
              ...allOrder,
            ],
          }),
        );
      });
  window.taskerWidgetSnapshot = () => void writeWidgetSnapshot().catch(() => {});
  window.addEventListener("tasker:db-changed", () => window.taskerWidgetSnapshot?.());
  // Due-time reminders: native code keeps an alarm for the earliest one and
  // delivers it even while Tasker is closed. Rescheduled after every change and sync.
  const writeReminders = async () => {
    if (!bridge.reminders) return;
    const [settings, tasks] = await Promise.all([
      get<{ notifications?: boolean }>("settings:get"),
      get<Task[]>("tasks:getAll"),
    ]);
    bridge.reminders(
      JSON.stringify(settings.notifications ? upcomingReminders(tasks, new Date()) : []),
    );
  };
  let reminderTimer: number | undefined;
  const scheduleReminders = () => {
    window.clearTimeout(reminderTimer);
    reminderTimer = window.setTimeout(() => void writeReminders().catch(() => {}), 300);
  };
  window.addEventListener("tasker:db-changed", scheduleReminders);
  if (!hidden) scheduleReminders();
  const transport = {
    invoke: (channel: string, ...args: unknown[]) =>
      registry.invoke(channel, args).then((result) => {
        if (
          !hidden &&
          !/^(tasks:(get|search)|lists:(get|is|setCollapsed|setHideCompleted)|undo:(can|reload))/.test(
            channel,
          )
        )
          androidSync().engine.localChanged();
        if (!/^(tasks:(get|search)|lists:(get|is)|undo:(can|reload)|settings:get)/.test(channel))
          scheduleReminders();
        return result;
      }),
  };
  // Reminder buttons that change the task. They run through the same operations as
  // the UI, so a repeating task rolls forward, undo works and sync records the change.
  window.taskerNotificationAction = async (json) => {
    const { action, taskId } = JSON.parse(json) as { action: string; taskId: string };
    if (action === "done") await transport.invoke("tasks:setStatus", taskId, 2);
    if (action === "tomorrow") {
      const task = await get<Task | null>("tasks:getById", [taskId]);
      const tomorrow = formatDate(addDays(new Date(), 1));
      if (task) await transport.invoke("tasks:rename", taskId, withMetadata(task, { dueDate: tomorrow }));
    }
    if (hidden) {
      window.clearTimeout(reminderTimer);
      await Promise.all([writeReminders(), writeWidgetSnapshot()]);
    } else window.dispatchEvent(new Event("tasker:db-changed"));
  };
  const visibility = (visible: boolean, callback: () => void) => {
    const listener = () => {
      if ((document.visibilityState === "visible") === visible) callback();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  };
  configureHost({
    touch: true,
    notifications: !!bridge.reminders,
    operations: {
      ...tasksInvokerFactory(transport),
      ...listsInvokerFactory(transport),
      ...undoInvokerFactory(transport),
    ...settingsInvokerFactory(transport),
    },
    onDbChanged: (cb) => {
      window.addEventListener("tasker:db-changed", cb);
      return () => window.removeEventListener("tasker:db-changed", cb);
    },
    onPopupShown: (cb) => visibility(true, cb),
    onPopupHidden: (cb) => visibility(false, cb),
    async openExternal(url) {
      if (/^\/attachments\/[a-f0-9-]{36}$/.test(url)) {
        window.dispatchEvent(
          new CustomEvent("tasker:previewImage", { detail: url }),
        );
      } else if (/^https?:\/\//i.test(url)) bridge.openExternal(url);
    },
    async saveImage(file) {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        )
      )
        throw new Error("Use a PNG, JPEG, WebP or GIF image");
      if (!file.size || file.size > 10 * 1024 * 1024)
        throw new Error("Images must be between 1 byte and 10 MB");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.readAsDataURL(file);
      });
      return callNative<string>(bridge, "saveImage", {
        data,
        mimeType: file.type,
      });
    },
    resolveMedia(src) {
      return /^\/attachments\/[a-f0-9-]+$/.test(src) || /^https?:\/\//.test(src)
        ? src
        : "";
    },
  });
}
