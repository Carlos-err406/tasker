import { Archive, History, RefreshCw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button.js";
import { PanelHeader } from "./PanelHeader.js";
import { GoogleLogo } from "./GoogleLogo.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog.js";
import { cn } from "../lib/utils.js";

type Manage = <T = unknown>(payload: Record<string, unknown>) => Promise<T>;
interface Backup {
  id: string;
  createdAt: string;
  kind: string;
  size: number;
  fileId?: string;
}
interface BackupStatus {
  local: Backup[];
  configured: boolean;
  connected: boolean;
  pending: boolean;
  lastCloud: string | null;
  localError: string | null;
  cloudError: string | null;
  uploading: boolean;
  progress?: { done: number; total: number } | null;
}
interface SyncStatus {
  enabled: boolean;
  syncing: boolean;
  pending: boolean;
  lastSync: string | null;
  error: string | null;
}
interface RestoreChoice {
  id: string;
  createdAt: string;
  kind: string;
  size: number;
  local?: Backup;
  cloud?: Backup;
}

// Both hosts word expired or revoked Google grants as "Reconnect Google Drive…".
const needsReconnect = (error: string | null | undefined) =>
  !!error && /reconnect/i.test(error);

function when(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return date.toDateString() === new Date().toDateString()
    ? `today ${time}`
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** One place for the Google connection, sync and backups. */
export function BackupsPanel({
  onClose,
  onRestored,
  manage,
  manageSync,
  deviceName = "Mac",
  onBusyChange,
}: {
  onClose: () => void;
  onRestored: () => void | Promise<void>;
  manage: Manage;
  manageSync: Manage;
  deviceName?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const resumeSync = useRef(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  async function poll() {
    const [backups, syncing] = await Promise.allSettled([
      manage<BackupStatus>({ action: "status" }),
      manageSync<SyncStatus>({ action: "sync-status" }),
    ]);
    if (backups.status === "fulfilled") setStatus(backups.value);
    else setError(message(backups.reason));
    if (syncing.status === "fulfilled") setSync(syncing.value);
    return {
      backups: backups.status === "fulfilled" ? backups.value : null,
      sync: syncing.status === "fulfilled" ? syncing.value : null,
    };
  }
  useEffect(() => {
    if (busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function loop() {
      const next = await poll();
      if (!active) return;
      // A reconnect only finishes in the browser; resume sync once it has.
      if (resumeSync.current && next.backups && !next.backups.pending) {
        resumeSync.current = false;
        if (next.backups.connected && !needsReconnect(next.backups.cloudError))
          void run(manageSync, next.sync?.enabled ? "sync-now" : "sync-enable");
      }
      timer = setTimeout(() => void loop(), 1000);
    }
    void loop();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [manage, manageSync, busy]);

  async function run(target: Manage, action: string) {
    setBusy(true);
    setError("");
    try {
      await target({ action });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function connect() {
    resumeSync.current = !!status?.connected;
    void run(manage, "connect");
  }

  const expired =
    !!status?.connected &&
    (needsReconnect(status.cloudError) || needsReconnect(sync?.error));
  const newest = [...(status?.local ?? [])].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0];
  const inDrive =
    !!newest &&
    !!status?.lastCloud &&
    Date.parse(status.lastCloud) >= Date.parse(newest.createdAt);
  const syncError = sync?.error && !needsReconnect(sync.error) ? sync.error : "";
  const cloudError =
    status?.cloudError && !needsReconnect(status.cloudError)
      ? status.cloudError
      : "";

  const shownErrors = [syncError, cloudError, status?.localError];
  const backupDetail = status?.uploading
    ? status.progress
      ? `Uploading to Drive (${Math.min(status.progress.done + 1, status.progress.total)} of ${status.progress.total})…`
      : "Uploading to Drive…"
    : newest
      ? `Last backup ${when(newest.createdAt)} · ${inDrive ? `${deviceName} + Drive` : `this ${deviceName} only`}`
      : "No backups yet";

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Backups & Sync"
        icon={Archive}
        onClose={() => {
          if (!busy) onClose();
        }}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <div className={GROUP}>
          <Row
            icon={<GoogleLogo />}
            title="Google Drive"
            tone={expired ? "warn" : undefined}
            alert={expired}
            detail={
              !status
                ? "Loading…"
                : !status.configured
                  ? "Setup required: see docs/google-setup.md"
                  : status.pending
                    ? "Waiting for you to finish in the browser…"
                    : !status.connected
                      ? "Connect to sync devices and keep backups in Drive"
                      : expired
                        ? "Google login expired"
                        : "Connected"
            }
          >
            {status?.configured && !status.pending && (!status.connected || expired) && (
              <Button size="sm" disabled={busy} onClick={connect}>
                {expired ? "Reconnect" : "Connect"}
              </Button>
            )}
          </Row>
          {status?.connected && sync && (
            <Row
              icon={
                <RefreshCw
                  className={cn(ICON, sync.syncing && "animate-spin")}
                />
              }
              title="Sync"
              status
              error={syncError}
              detail={
                sync.syncing
                  ? "Syncing…"
                  : !sync.enabled
                    ? "Paused"
                    : sync.pending
                      ? "Changes waiting to sync"
                      : sync.lastSync
                        ? `Up to date · ${when(sync.lastSync)}`
                        : "Not synced yet"
              }
            >
              {sync.enabled && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sync now"
                  title="Sync now"
                  disabled={busy || sync.syncing || expired}
                  onClick={() => void run(manageSync, "sync-now")}
                >
                  <RefreshCw />
                </Button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={sync.enabled}
                aria-label="Sync"
                disabled={busy || expired}
                onClick={() =>
                  void run(manageSync, sync.enabled ? "sync-pause" : "sync-enable")
                }
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
                  sync.enabled ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
                    sync.enabled && "translate-x-4",
                  )}
                />
              </button>
            </Row>
          )}
        </div>

        <div className={GROUP}>
          <Row
            icon={<Archive className={ICON} />}
            title="Backup"
            status={!!status?.uploading}
            error={status?.localError || cloudError}
            detail={backupDetail}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(manage, "backup")}
            >
              Back up now
            </Button>
          </Row>
          <Row
            icon={<History className={ICON} />}
            title="Restore"
            detail={`From this ${deviceName}${status?.connected ? " or Drive" : ""}`}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !status}
              onClick={() => setRestoring(true)}
            >
              Restore…
            </Button>
          </Row>
        </div>

        {error && !shownErrors.includes(error) && (
          <div role="alert" className="px-1 text-xs text-destructive">
            {error}
          </div>
        )}

        {status?.connected && (
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => void run(manage, "disconnect")}
          >
            Disconnect Google
          </Button>
        )}
      </div>
      {restoring && status && (
        <RestoreDialog
          manage={manage}
          local={status.local}
          connected={status.connected && !expired}
          deviceName={deviceName}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setRestoring(false)}
          onRestored={async () => {
            await onRestored();
            await poll();
          }}
        />
      )}
    </section>
  );
}

const GROUP =
  "divide-y divide-border overflow-hidden rounded-lg border border-border bg-muted/20";
const ICON = "size-4 text-muted-foreground";

function Row({
  icon,
  title,
  detail,
  tone,
  error,
  alert,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  tone?: "warn";
  error?: string | null;
  alert?: boolean;
  status?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div
          role={alert ? "alert" : status ? "status" : undefined}
          className={cn(
            "text-xs text-muted-foreground",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
          )}
        >
          {detail}
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      )}
    </div>
  );
}

function RestoreDialog({
  manage,
  local,
  connected,
  deviceName,
  busy,
  setBusy,
  onClose,
  onRestored,
}: {
  manage: Manage;
  local: Backup[];
  connected: boolean;
  deviceName: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [cloud, setCloud] = useState<Backup[] | null>(connected ? null : []);
  const [selected, setSelected] = useState<RestoreChoice | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) return;
    let active = true;
    manage<Backup[]>({ action: "cloud-list" })
      .then((items) => active && setCloud(items))
      .catch((e) => {
        if (!active) return;
        setCloud([]);
        setError(`Could not list Drive backups: ${message(e)}`);
      });
    return () => {
      active = false;
    };
  }, [connected, manage]);

  const choices = new Map<string, RestoreChoice>();
  for (const backup of local) choices.set(backup.id, { ...backup, local: backup });
  for (const backup of cloud ?? [])
    choices.set(backup.id, {
      ...backup,
      ...choices.get(backup.id),
      cloud: backup,
    });
  const sorted = [...choices.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  async function restore(choice: RestoreChoice) {
    setBusy(true);
    setError("");
    try {
      // Prefer the local copy; Drive-only snapshots download first.
      await manage({
        action: "restore",
        id: choice.local ? choice.local.id : choice.cloud!.fileId,
        cloud: !choice.local,
        confirm: true,
      });
      await onRestored();
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {selected ? (
          <>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription>
              This replaces current tasks and images with the snapshot from{" "}
              {new Date(selected.createdAt).toLocaleString()}. A safety backup
              of the current database is kept. Sync pauses; turning it back on
              publishes the restored tasks.
            </DialogDescription>
            {error && <p role="alert">{error}</p>}
            <div className="toolbar">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Back
              </Button>
              <Button disabled={busy} onClick={() => void restore(selected)}>
                {busy ? "Restoring…" : "Restore backup"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle>Restore a backup</DialogTitle>
            <DialogDescription>
              Snapshots on this {deviceName} and in your Drive, newest first.
            </DialogDescription>
            {error && <p role="alert">{error}</p>}
            <div>
              {sorted.map((choice) => (
                <div className="backup-row" key={choice.id}>
                  <div>
                    <strong>{new Date(choice.createdAt).toLocaleString()}</strong>
                    <small>
                      {[
                        choice.kind,
                        `${(choice.size / 1024).toFixed(0)} KB`,
                        [choice.local && deviceName, choice.cloud && "Drive"]
                          .filter(Boolean)
                          .join(" + "),
                      ].join(" · ")}
                    </small>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setSelected(choice)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
              {cloud === null && <p>Loading Drive backups…</p>}
              {cloud !== null && sorted.length === 0 && <p>No backups yet.</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
