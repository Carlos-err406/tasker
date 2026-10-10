export interface SyncStatus {
  enabled: boolean;
  syncing: boolean;
  pending: boolean;
  lastSync: string | null;
  error: string | null;
}

export type SyncState = "syncing" | "failed" | "waiting" | "synced";

/** What the task screen says about sync; null while sync is off. */
export function syncSummary(
  status: SyncStatus | null,
  now: Date,
): { state: SyncState; label: string } | null {
  if (!status?.enabled) return null;
  if (status.syncing) return { state: "syncing", label: "Syncing…" };
  if (status.error) return { state: "failed", label: "Sync failed" };
  if (status.pending) return { state: "waiting", label: "Waiting to sync" };
  if (!status.lastSync) return { state: "waiting", label: "Not synced yet" };
  const last = new Date(status.lastSync);
  return {
    state: "synced",
    label: `Synced ${
      last.toDateString() === now.toDateString()
        ? last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : last.toLocaleDateString([], { month: "short", day: "numeric" })
    }`,
  };
}
