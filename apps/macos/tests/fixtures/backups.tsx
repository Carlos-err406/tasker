import React from "react";
import { createRoot } from "react-dom/client";
import { BackupsPanel } from "../../../../packages/ui/src/components/BackupsPanel";
import "../../../../packages/ui/src/styles.css";
import "../../../android/src/mobile.css";
const params = new URLSearchParams(location.search);
const local = [
  { id: "old", createdAt: "2026-09-28T12:00:00Z", kind: "oldest", size: 1000 },
  { id: "new", createdAt: "2026-09-28T14:00:00Z", kind: "newest", size: 3000 },
];
const cloud = [
  { id: "new", createdAt: "2026-09-28T14:00:00Z", kind: "newest", size: 3000, fileId: "drive-new" },
  { id: "phone", createdAt: "2026-09-28T13:00:00Z", kind: "phone", size: 2000, fileId: "drive-phone" },
];
const status = {
  local,
  configured: true,
  connected: !params.has("disconnected"),
  pending: false,
  uploading: params.has("uploading"),
  progress: params.has("uploading") ? { done: 1, total: 4 } : null,
  lastCloud: "2026-09-28T14:00:00Z" as string | null,
  cloudError: params.has("expired")
    ? "Google authorization expired or failed. Reconnect Google Drive."
    : (null as string | null),
  localError: null,
};
let sync = {
  enabled: !params.has("paused"),
  syncing: false,
  pending: false,
  lastSync: "2026-09-28T14:05:00Z" as string | null,
  error: params.has("expired") ? "Reconnect Google Drive" : (null as string | null),
};
const calls: Record<string, unknown>[] = [];
Reflect.set(window, "calls", calls);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function manage<T>(request: Record<string, unknown>): Promise<T> {
  calls.push(request);
  switch (request.action) {
    case "connect":
      status.pending = true;
      setTimeout(() => {
        Object.assign(status, { pending: false, connected: true, cloudError: null });
      }, 300);
      break;
    case "disconnect":
      Object.assign(status, { connected: false, lastCloud: null });
      sync = { ...sync, enabled: false };
      break;
    case "cloud-list":
      await delay(100);
      return cloud as T;
    case "restore":
      await delay(100);
      break;
    case "sync-status":
      return { ...sync } as T;
    case "sync-enable":
      await delay(100);
      sync = { ...sync, enabled: true, error: null };
      return { ...sync } as T;
    case "sync-pause":
      sync = { ...sync, enabled: false };
      return { ...sync } as T;
    case "sync-now":
      await delay(200);
      if (params.has("failure")) {
        sync = { ...sync, error: "Network unavailable" };
        throw new Error("Network unavailable");
      }
      sync = { ...sync, error: null, lastSync: new Date().toISOString() };
      return { ...sync } as T;
  }
  return { ...status } as T;
}
createRoot(document.getElementById("root")!).render(
  <main className="mobile-shell">
    <div className="mobile-workspace mobile-backups">
      <BackupsPanel
        manage={manage}
        manageSync={manage}
        onClose={() => {}}
        onRestored={() => {}}
        deviceName={params.has("mobile") ? "phone" : "Mac"}
      />
    </div>
  </main>,
);
