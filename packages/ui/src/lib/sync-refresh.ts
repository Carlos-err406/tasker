type Manage = <T = unknown>(payload: Record<string, unknown>) => Promise<T>;
interface SyncStatus {
  enabled: boolean;
  error: string | null;
}

/** Syncs with Google Drive when sync is enabled, then reloads tasks either way. */
export async function syncAndRefresh(
  manage: Manage,
  showStatus: (message: string) => void,
  refresh: () => Promise<void>,
) {
  try {
    const { enabled } = await manage<SyncStatus>({ action: "sync-status" });
    if (enabled) {
      showStatus("Syncing…");
      const { error } = await manage<SyncStatus>({ action: "sync-now" });
      showStatus(error ? `Sync failed: ${error}` : "Synced");
    }
  } catch (e) {
    showStatus(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await refresh();
}
