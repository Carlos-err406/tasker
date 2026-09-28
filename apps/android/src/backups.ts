import { beforeBackupRestore, afterBackupRestore, androidSync } from "./sync";
declare global {
  interface Window {
    taskerBackupResult?: (id: string, result: string) => void;
  }
}
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
window.taskerBackupResult = (id, json) => {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  try {
    const response = JSON.parse(json);
    if (response.error) request.reject(new Error(response.error));
    else request.resolve(response.result);
  } catch {
    request.reject(new Error("Could not read the backup result"));
  }
};

export async function manageBackups<T = unknown>(
  payload: Record<string, unknown>,
): Promise<T> {
  const restore = payload.action === "restore";
  if (restore) beforeBackupRestore();
  if (payload.action === "disconnect") androidSync().engine.pause();
  try {
    return await new Promise<T>((resolve, reject) => {
      const bridge = window.TaskerNative;
      if (!bridge?.backups) {
        reject(new Error("Update Tasker to use backups"));
        return;
      }
      const id = crypto.randomUUID();
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        bridge.backups(id, JSON.stringify(payload));
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  } finally {
    if (restore) afterBackupRestore();
  }
}
