import { useEffect, useState } from "react";
import { Cloud, CloudAlert, CloudUpload, RefreshCw } from "lucide-react";
import { manageSync } from "./sync";
import { syncSummary, type SyncState, type SyncStatus } from "./sync-summary";

const ICONS: Record<SyncState, typeof Cloud> = {
  syncing: RefreshCw,
  failed: CloudAlert,
  waiting: CloudUpload,
  synced: Cloud,
};

/** Sync state beside the status line, checked every second while the app is open. */
export function SyncIndicator() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      manageSync<SyncStatus>({ action: "sync-status" }).then(
        (next) => active && setStatus(next),
        () => active && setStatus(null),
      );
    };
    poll();
    const timer = setInterval(poll, 1000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);
  const summary = syncSummary(status, new Date());
  if (!summary) return null;
  const Icon = ICONS[summary.state];
  return (
    <span className="mobile-sync" data-state={summary.state}>
      <Icon
        aria-hidden="true"
        className={summary.state === "syncing" ? "animate-spin" : undefined}
      />
      {summary.label}
    </span>
  );
}
