import type { AndroidBridge } from "./database";
import type { UpdateStatus } from "@tasker/ui";
export type { UpdateStatus } from "@tasker/ui";
declare global {
  interface Window {
    taskerUpdateResult?: (id: string, json: string) => void;
  }
}
const pending = new Map<
  string,
  {
    resolve: (value: UpdateStatus) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
window.taskerUpdateResult = (id, json) => {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  try {
    const response = JSON.parse(json);
    if (response.error) throw Error(response.error);
    request.resolve(response.result);
  } catch (error) {
    request.reject(
      error instanceof Error ? error : Error("Could not read update status"),
    );
  }
};
export function manageUpdates(
  action: "status" | "check" | "install",
): Promise<UpdateStatus> {
  return new Promise((resolve, reject) => {
    const bridge = (window as Window & { TaskerNative?: AndroidBridge })
      .TaskerNative;
    if (!bridge?.updates) {
      reject(Error("Update Tasker to use update checks"));
      return;
    }
    const id = crypto.randomUUID(),
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Update request timed out. Try again."));
      }, 360000);
    pending.set(id, { resolve, reject, timer });
    try {
      bridge.updates(id, action);
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}
