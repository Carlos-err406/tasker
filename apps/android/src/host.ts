import { connectAndroidSync, androidSync } from "./sync";
import { configureHost } from "@tasker/ui/host";
import { tasksInvokerFactory } from "@tasker/ui/transport/tasks/preload";
import { listsInvokerFactory } from "@tasker/ui/transport/lists/preload";
import { undoInvokerFactory } from "@tasker/ui/transport/undo/preload";
import { UndoManager } from "@tasker/core/undo";
import { createRegistry } from "@tasker/core/operations";
import {
  callNative,
  createAndroidDatabase,
  type AndroidBridge,
} from "./database";

declare global {
  interface Window {
    TaskerNative?: AndroidBridge;
    taskerBack?: () => boolean;
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
