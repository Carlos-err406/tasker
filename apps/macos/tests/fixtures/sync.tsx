import React from "react";
import { createRoot } from "react-dom/client";
import { SyncPanel } from "@tasker/ui";
import "@tasker/ui/styles.css";
import "../../../android/src/mobile.css";
const query = new URLSearchParams(location.search),
  mobile = query.has("mobile");
document.documentElement.classList.add("dark");
let status = {
  enabled: false,
  syncing: false,
  pending: true,
  lastSync: null as string | null,
  error: null as string | null,
};
async function manage<T>(request: Record<string, unknown>): Promise<T> {
  if (request.action === "sync-enable") {
    await new Promise((r) => setTimeout(r, 150));
    status = {
      ...status,
      enabled: true,
      pending: false,
      lastSync: "2026-09-28T12:00:00Z",
    };
  }
  if (request.action === "sync-now") {
    await new Promise((r) => setTimeout(r, 250));
    if (query.has("failure")) throw new Error("Network unavailable");
    status = { ...status, lastSync: "2026-09-28T13:00:00Z" };
  }
  if (request.action === "sync-pause") status = { ...status, enabled: false };
  return status as T;
}
createRoot(document.getElementById("root")!).render(
  <div
    className={
      mobile
        ? "mobile-app"
        : "flex h-screen flex-col bg-background text-foreground"
    }
  >
    <SyncPanel
      manage={manage}
      deviceName={mobile ? "Android" : "Mac"}
      onClose={() => {}}
      onViewBackups={() => {}}
    />
  </div>,
);
