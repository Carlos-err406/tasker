import { Archive } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button.js";
import { PanelHeader } from "./PanelHeader.js";
import { GoogleLogo } from "./GoogleLogo.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog.js";
interface Backup {
  id: string;
  createdAt: string;
  kind: string;
  size: number;
  fileId?: string;
}
interface Status {
  local: Backup[];
  configured: boolean;
  connected: boolean;
  pending: boolean;
  lastCloud: string | null;
  localError: string | null;
  cloudError: string | null;
  uploading: boolean;
}
export function BackupsPanel({
  onClose,
  onRestored,
  manage,
  deviceName = "Mac",
  onBusyChange,
  onViewSync,
}: {
  onClose: () => void;
  onRestored: () => void | Promise<void>;
  manage: <T = unknown>(payload: Record<string, unknown>) => Promise<T>;
  deviceName?: string;
  onBusyChange?: (busy: boolean) => void;
  onViewSync?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [cloud, setCloud] = useState<Backup[]>([]);
  const [selected, setSelected] = useState<Backup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadRequested, setUploadRequested] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const refresh = () =>
    manage<Status>({ action: "status" })
      .then(setStatus)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    if (busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await manage<Status>({ action: "status" });
        if (active) setStatus(next);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [manage, busy]);
  async function action(payload: Record<string, unknown>) {
    setBusy(true);
    setUploadRequested(payload.action === "upload");
    setError("");
    try {
      const result = await manage<Status>(payload);
      if (payload.action === "upload") setStatus(result);
      else await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploadRequested(false);
      setBusy(false);
    }
  }
  const list = (items: Backup[]) =>
    [...items]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((b) => (
        <div className="backup-row" key={b.fileId ?? b.id}>
          <div>
            <strong>{new Date(b.createdAt).toLocaleString()}</strong>
            <small>
              {b.kind} · {(b.size / 1024).toFixed(0)} KB
            </small>
          </div>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => setSelected(b)}
          >
            Restore
          </Button>
        </div>
      ));
  return (
    <section className="backups">
      <PanelHeader
        title="Backups"
        icon={Archive}
        onClose={() => {
          if (!busy) onClose();
        }}
      />
      {onViewSync && <div className="px-4 pt-3"><Button variant="outline" disabled={busy} onClick={onViewSync}>View sync</Button></div>}
      <div className="backups-body">
        <p>
          Your tasks and pasted images are stored on this {deviceName}.
          Restoring a backup replaces the current task database.
        </p>
        <Button
          disabled={busy}
          onClick={() => void action({ action: "backup" })}
        >
          Back up now
        </Button>
        {status?.localError && <p role="alert">{status.localError}</p>}
        <h3>Local snapshots</h3>
        {list(status?.local ?? [])}
        {status?.local.length === 0 && <p>No backups yet.</p>}
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GoogleLogo />
          Google Drive backups
        </h3>
        {!status ? (
          <p>Loading backup status…</p>
        ) : !status.configured ? (
          <p>
            Google setup is required. Follow <code>docs/google-setup.md</code>{" "}
            in the repository.
          </p>
        ) : (
          <div className="toolbar">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || status.pending || status.uploading}
              onClick={() => void action({ action: "connect" })}
            >
              <GoogleLogo />
              {status.pending
                ? "Waiting for Google…"
                : status.connected
                  ? "Reconnect"
                  : "Connect Google"}
            </Button>
            {status.connected && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || status.uploading}
                  onClick={() => void action({ action: "upload" })}
                >
                  {status.uploading || uploadRequested
                    ? "Uploading…"
                    : "Upload now"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCloud([]);
                    void action({ action: "disconnect" });
                  }}
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>
        )}
        {status?.lastCloud && (
          <p>
            Last cloud backup: {new Date(status.lastCloud).toLocaleString()}
          </p>
        )}
        {status?.cloudError && <p role="alert">{status.cloudError}</p>}
        {status?.connected && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void manage<Backup[]>({ action: "cloud-list" })
                .then(setCloud)
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            Browse Drive backups
          </Button>
        )}
        {list(cloud)}
        {error && <p role="alert">{error}</p>}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Restore this backup?</DialogTitle>
          <DialogDescription>
            This replaces current tasks and images with the snapshot from{" "}
            {selected && new Date(selected.createdAt).toLocaleString()}. A
            safety backup of the current database will be kept. Sync will pause;
            resuming sync publishes the restored changes.
          </DialogDescription>
          {error && <p role="alert">{error}</p>}
          <div className="toolbar">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!selected) return;
                setBusy(true);
                setError("");
                try {
                  await manage({
                    action: "restore",
                    id: selected.fileId ?? selected.id,
                    cloud: !!selected.fileId,
                    confirm: true,
                  });
                  setSelected(null);
                  await onRestored();
                  await refresh();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Restoring…" : "Restore backup"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
