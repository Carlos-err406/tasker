import React from "react";
import { createRoot } from "react-dom/client";
import { BackupsPanel } from "../../../../packages/ui/src/components/BackupsPanel";
import "../../../../packages/ui/src/styles.css";
import "../../../android/src/mobile.css";
const params = new URLSearchParams(location.search);
const snapshots = [
  { id: "old", createdAt: "2026-09-28T12:00:00Z", kind: "oldest", size: 1000 },
  {
    id: "offset",
    createdAt: "2026-09-28T15:00:00+02:00",
    kind: "middle",
    size: 2000,
  },
  { id: "new", createdAt: "2026-09-28T14:00:00Z", kind: "newest", size: 3000 },
];
const status = {
  local: snapshots,
  configured: true,
  connected: true,
  pending: false,
  uploading: params.has("auto"),
  lastCloud: null,
  cloudError: null as string | null,
  localError: null,
};
if (status.uploading)
  setTimeout(() => {
    status.uploading = false;
  }, 500);
async function manage<T>(request: Record<string, unknown>): Promise<T> {
  if (request.action === "upload") {
    status.uploading = true;
    await new Promise((resolve) => setTimeout(resolve, 350));
    status.uploading = false;
    status.cloudError = params.has("failure") ? "Upload failed: offline" : null;
  }
  if (request.action === "cloud-list")
    return snapshots.map((s) => ({ ...s, fileId: s.id })) as T;
  return { ...status } as T;
}
createRoot(document.getElementById("root")!).render(
  <main className="mobile-shell">
    <div className="mobile-workspace mobile-backups">
      <BackupsPanel
        manage={manage}
        onClose={() => {}}
        onRestored={() => {}}
        deviceName={params.has("mobile") ? "phone" : "Mac"}
      />
    </div>
  </main>,
);
