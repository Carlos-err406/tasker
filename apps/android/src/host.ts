import { connectAndroidSync, androidSync } from "./sync";
import { widgetImages, widgetNotes } from "./widget";
import { configureHost } from "@tasker/ui/host";
import { tasksInvokerFactory } from "@tasker/ui/transport/tasks/preload";
import { listsInvokerFactory } from "@tasker/ui/transport/lists/preload";
import { undoInvokerFactory } from "@tasker/ui/transport/undo/preload";
import { settingsInvokerFactory } from "@tasker/ui/transport/settings/preload";
import { UndoManager } from "@tasker/core/undo";
import { createRegistry } from "@tasker/core/operations";
import { formatTime, parseTaskDescription } from "@tasker/core/parsers";
import type { Task } from "@tasker/core/types";
import {
  getDescriptionPreview,
  getDisplayTitle,
  getTagColor,
  TAG_COLORS,
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
  }
}
export function connectAndroidHost() {
  const bridge = window.TaskerNative;
  if (!bridge) throw new Error("Open this app from Tasker on Android.");
  const db = createAndroidDatabase(bridge);
  connectAndroidSync(db, bridge);
  let registry = createRegistry(db, new UndoManager(db), androidSync().store);
  window.addEventListener("tasker:sync-reset", () => {
    registry = createRegistry(db, new UndoManager(db), androidSync().store);
  });
  // The home-screen widget draws this snapshot. Native asks for it whenever the app
  // leaves the foreground; a sync that lands afterwards refreshes it too.
  window.taskerWidgetSnapshot = () => {
    const get = async <T>(channel: string) => {
      const [error, value] = (await registry.invoke(channel, [])) as
        | [null, T]
        | [{ message: string }, null];
      if (error) throw new Error(error.message);
      return value as T;
    };
    void Promise.all([
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
      })
      .catch(() => {});
  };
  window.addEventListener("tasker:db-changed", () => window.taskerWidgetSnapshot?.());
  const transport = {
    invoke: (channel: string, ...args: unknown[]) =>
      registry.invoke(channel, args).then((result) => {
        if (
          !/^(tasks:(get|search)|lists:(get|is|setCollapsed|setHideCompleted)|undo:(can|reload))/.test(
            channel,
          )
        )
          androidSync().engine.localChanged();
        return result;
      }),
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
