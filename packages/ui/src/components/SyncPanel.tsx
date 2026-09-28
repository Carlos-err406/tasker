import { useEffect, useRef, useState } from "react";
import { RefreshCw, Pause, Check } from "lucide-react";
import { Button } from "./ui/button.js";
import { PanelHeader } from "./PanelHeader.js";
import { GoogleLogo } from "./GoogleLogo.js";
interface Status {
  enabled: boolean;
  syncing: boolean;
  pending: boolean;
  lastSync: string | null;
  error: string | null;
}
export function SyncPanel({
  manage,
  onClose,
  onViewBackups,
  deviceName = "Mac",
  backLabel,
}: {
  manage: <T = unknown>(payload: Record<string, unknown>) => Promise<T>;
  onClose: () => void;
  onViewBackups: () => void;
  deviceName?: string;
  backLabel?: string;
}) {
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (busy) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await manage<Status>({ action: "sync-status" });
        if (active) setStatus(value);
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not read sync status",
          );
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [manage, busy]);
  const run = async (action: string) => {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await manage<Status>({ action });
      if (current === generation.current) setStatus(value);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Sync could not finish");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const working = busy || status?.syncing;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PanelHeader
        title="Sync"
        icon={RefreshCw}
        onClose={onClose}
        backLabel={backLabel}
      />
      <div className="space-y-5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <GoogleLogo /> Google Drive
        </div>
        <p className="text-muted-foreground">
          Keep your tasks, lists, and images together on Mac and Android. Use
          the same Google account on both devices.
        </p>
        <div
          className="rounded-lg border border-border bg-muted/30 p-3 space-y-2"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 font-medium">
            {working ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : status?.enabled && !status.error && !status.pending ? (
              <Check className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {working
              ? "Syncing…"
              : !status
                ? "Loading…"
                : !status.enabled
                  ? "Sync paused"
                  : status.error
                    ? "Sync needs attention"
                    : status.pending
                      ? "Changes waiting to sync"
                      : "Up to date"}
          </div>
          <p className="text-muted-foreground">
            {status?.lastSync
              ? `Last synced ${new Date(status.lastSync).toLocaleString()}`
              : "Not synced yet"}
          </p>
        </div>
        {(error || status?.error) && (
          <p role="alert" className="text-destructive">
            {error || status?.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {status?.enabled ? (
            <>
              <Button disabled={!!working} onClick={() => void run("sync-now")}>
                <RefreshCw />
                {working ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="outline" onClick={() => void run("sync-pause")}>
                Pause sync
              </Button>
            </>
          ) : (
            <Button
              disabled={!!working || !status}
              onClick={() => void run("sync-enable")}
            >
              <GoogleLogo />
              Enable sync
            </Button>
          )}
          <Button variant="outline" onClick={onViewBackups}>
            View backups
          </Button>
        </div>
        <p className="text-muted-foreground">
          Enabling sync combines this device’s tasks with the tasks already
          synced to your Google account. The most recent edit wins if both
          devices change the same task.
        </p>
        <p className="text-muted-foreground">
          {deviceName === "Android"
            ? "Sync runs while Tasker is open."
            : "Sync runs while Tasker’s Mac service is running."}{" "}
          You can keep editing offline. A safety backup is saved before enabling
          sync.
        </p>
        <p className="text-muted-foreground">
          Connect Google in Backups if needed. Restoring a backup pauses sync;
          resuming publishes the restored changes.
        </p>
      </div>
    </section>
  );
}
