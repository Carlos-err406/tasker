import React from "react";
import { createRoot } from "react-dom/client";
import { AboutPanel } from "@tasker/ui";
import type { UpdateStatus } from "../../../android/src/updates";
import "@tasker/ui/styles.css";
import "../../../android/src/mobile.css";
const query = new URLSearchParams(location.search);
let status: UpdateStatus = {
  currentVersion: "0.1.1",
  version: null,
  phase: "idle",
  busy: false,
  progress: 0,
  error: null,
};
async function manage(action: "status" | "check" | "install") {
  if (action === "check") {
    status = { ...status, phase: "checking", busy: true, error: null };
    await new Promise((r) => setTimeout(r, 150));
    status = {
      ...status,
      busy: false,
      version: query.has("missing") ? null : "0.1.2",
      phase: query.has("missing") ? "unpublished" : "available",
    };
  }
  if (action === "install") {
    status = { ...status, busy: true, phase: "downloading", progress: 50 };
    // ?hold keeps the download running until the test calls finishDownload(),
    // so slow runners cannot miss the transient state.
    await new Promise((r) =>
      query.has("hold")
        ? Reflect.set(window, "finishDownload", r)
        : setTimeout(r, 700),
    );
    status = {
      ...status,
      busy: false,
      phase: query.has("fail") ? "error" : "permission",
      error: query.has("fail") ? "Download failed. Try again." : null,
    };
  }
  return { ...status };
}
createRoot(document.getElementById("root")!).render(
  <div
    className={query.has("desktop") ? "flex h-screen flex-col" : "mobile-shell"}
  >
    <div
      className={
        query.has("desktop")
          ? "flex min-h-0 flex-1 flex-col"
          : "mobile-workspace mobile-backups"
      }
    >
      <AboutPanel
        platform={query.has("desktop") ? "Mac" : "Android"}
        manage={manage}
        openExternal={async (url) => {
          document.body.dataset.openedUrl = url;
        }}
        onClose={() => {}}
      />
    </div>
  </div>,
);
