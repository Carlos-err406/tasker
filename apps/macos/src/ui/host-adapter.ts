import { configureHost, type Operations } from "@tasker/ui/host";
import { tasksInvokerFactory } from "@tasker/ui/transport/tasks/preload";
import { listsInvokerFactory } from "@tasker/ui/transport/lists/preload";
import { undoInvokerFactory } from "@tasker/ui/transport/undo/preload";
export async function connectHost() {
  const token = location.hash.slice(1);
  if (token) {
    const response = await fetch("/session", {
      method: "POST",
      headers: { "x-tasker-bootstrap": token },
    });
    if (!response.ok)
      throw new Error("Could not authenticate. Reopen Tasker from SwiftBar.");
    history.replaceState(null, "", location.pathname);
  }
  const invoke = async (channel: string, ...args: unknown[]) => {
    const response = await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tasker-request": "1" },
      body: JSON.stringify({ channel, args }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const transport = { invoke };
  const operations: Operations = {
    ...tasksInvokerFactory(transport),
    ...listsInvokerFactory(transport),
    ...undoInvokerFactory(transport),
  };
  const visibility = (visible: boolean, callback: () => void) => {
    const listener = () => {
      if ((document.visibilityState === "visible") === visible) callback();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  };
  configureHost({
    operations,
    onDbChanged: () => () => {},
    onPopupShown: (callback) => visibility(true, callback),
    onPopupHidden: (callback) => visibility(false, callback),
    async openExternal(url) {
      await manage({ action: "open", url });
    },
    async saveImage(file) {
      const response = await fetch("/attachments", {
        method: "POST",
        headers: { "content-type": file.type, "x-tasker-request": "1" },
        body: file,
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).reference;
    },
    resolveMedia(src) {
      if (/^\/attachments\/[a-f0-9-]+$/.test(src) || /^https?:\/\//.test(src))
        return src;
      return "";
    },
  });
}

export async function manage<T = unknown>(
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/manage", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tasker-request": "1" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
