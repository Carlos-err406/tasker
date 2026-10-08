import {
  SyncCoordinator,
  SyncDrive,
  SyncStore,
  type SyncSettings,
  type SyncHttpResponse,
} from "@tasker/core/sync";
import type { TaskerDb } from "@tasker/core/db";
import { callNative, type AndroidBridge } from "./database";
import { manageBackups } from "./backups";
declare global {
  interface Window {
    taskerSyncResult?: (id: string, json: string) => void;
  }
}
const pending = new Map<
  string,
  {
    resolve: (value: SyncHttpResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function encode(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
window.taskerSyncResult = (id, json) => {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  try {
    const response = JSON.parse(json);
    if (response.error) throw new Error(response.error);
    request.resolve({
      ...response.result,
      bytes: decode(response.result.body),
    });
  } catch (error) {
    request.reject(
      error instanceof Error ? error : new Error("Invalid sync response"),
    );
  }
};
let instance: ReturnType<typeof createSync> | undefined;
let hostDb: TaskerDb, hostBridge: AndroidBridge;
type State = SyncSettings & {
  restoreBaseline?: ReturnType<SyncStore["exportRestoreBaseline"]>;
};
function createSync(db: TaskerDb, bridge: AndroidBridge) {
  let settings = callNative<State>(bridge, "syncState");
  const save = (value: SyncSettings) => {
    settings = { ...settings, ...value };
    callNative(bridge, "syncState", { value: settings });
  };
  if (settings.restoreBaseline)
    for (const table of ["sync_records", "sync_aliases", "sync_meta"])
      callNative(bridge, "run", {
        sql: `DROP TABLE IF EXISTS ${table}`,
        params: [],
      });
  const store = new SyncStore(db, settings.replica, () => crypto.randomUUID());
  if (settings.restoreBaseline) {
    store.rebaseAfterRestore(settings.restoreBaseline);
    delete settings.restoreBaseline;
    save(settings);
  }
  const drive = new SyncDrive(
    {
      cancel() {
        bridge.syncCancel?.();
        for (const [id, p] of pending) {
          clearTimeout(p.timer);
          p.reject(new Error("Sync cancelled"));
          pending.delete(id);
        }
      },
      request(url, method, headers, bytes, maxBytes) {
        return new Promise<SyncHttpResponse>((resolve, reject) => {
          if (!bridge.sync) {
            reject(new Error("Update Tasker to use sync"));
            return;
          }
          const id = crypto.randomUUID(),
            timer = setTimeout(() => {
              pending.delete(id);
              bridge.syncCancel?.();
              reject(new Error("Sync request timed out"));
            }, 210000);
          pending.set(id, { resolve, reject, timer });
          try {
            bridge.sync(
              id,
              JSON.stringify({
                url,
                method,
                headers,
                body: bytes ? encode(bytes) : "",
                maxBytes,
              }),
            );
          } catch (error) {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
          }
        });
      },
    },
    {
      async read(id) {
        const r = callNative<{
          body: string;
          mimeType: string;
          createdAt: string;
        } | null>(bridge, "syncReadImage", { id });
        return r
          ? {
              bytes: decode(r.body),
              mimeType: r.mimeType,
              createdAt: r.createdAt,
            }
          : null;
      },
      async write(image, bytes) {
        callNative(bridge, "syncWriteImage", { image, body: encode(bytes) });
      },
    },
  );
  const engine = new SyncCoordinator(
    store,
    drive,
    settings,
    save,
    () => window.dispatchEvent(new Event("tasker:db-changed")),
    async () => {
      await manageBackups({ action: "safety-backup" });
    },
  );
  return { store, engine, settings: () => settings, save };
}
export function connectAndroidSync(db: TaskerDb, bridge: AndroidBridge) {
  hostDb = db;
  hostBridge = bridge;
  instance = createSync(db, bridge);
  document.addEventListener("visibilitychange", () =>
    instance?.engine.foreground(document.visibilityState === "visible"),
  );
  instance.engine.start();
  return instance;
}
export function androidSync() {
  if (!instance) throw new Error("Sync is not ready");
  return instance;
}
export function beforeBackupRestore() {
  if (!instance) return;
  instance.engine.pause();
  instance.engine.close();
  const state: State = {
    ...instance.settings(),
    enabled: false,
    replica: crypto.randomUUID(),
    sequence: 0,
    lastSync: null,
    restoreBaseline: instance.store.exportRestoreBaseline(),
  };
  callNative(hostBridge, "syncState", { value: state });
}
export function afterBackupRestore() {
  if (!instance) return;
  instance = createSync(hostDb, hostBridge);
  instance.engine.start();
  window.dispatchEvent(new Event("tasker:sync-reset"));
}
async function dispatchSync(payload: Record<string, unknown>) {
  const { engine } = androidSync();
  switch (payload.action) {
    case "sync-status":
      return engine.status();
    case "sync-enable":
      await engine.enable();
      return engine.status();
    case "sync-now":
      return engine.syncNow();
    case "sync-pause":
      engine.pause();
      return engine.status();
    case "sync-editing":
      engine.setEditing(payload.editing === true);
      return true;
    default:
      throw new Error("Unknown sync action");
  }
}

export async function manageSync<T = unknown>(
  payload: Record<string, unknown>,
): Promise<T> {
  return (await dispatchSync(payload)) as T;
}
