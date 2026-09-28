import { Archive } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  PanelHeader,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@tasker/ui";
import { manage } from "./host-adapter.js";
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
export function Backups({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [cloud, setCloud] = useState<Backup[]>([]);
  const [selected, setSelected] = useState<Backup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    manage<Status>({ action: "status" })
      .then(setStatus)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, []);
  async function action(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await manage(payload);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const list = (items: Backup[]) =>
    items.map((b) => (
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
      <PanelHeader title="Backups" icon={Archive} onClose={onClose} />
      <div className="backups-body">
        <p>
          Your tasks and pasted images are stored on this Mac. Restoring a
          backup replaces the current task database.
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
        <h3>Google Drive backups</h3>
        {!status?.configured ? (
          <p>
            Google setup is required. Follow <code>docs/google-setup.md</code>{" "}
            in the repository.
          </p>
        ) : (
          <div className="toolbar">
            <Button
              size="sm"
              disabled={busy || status.pending}
              onClick={() => void action({ action: "connect" })}
            >
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
                  disabled={busy}
                  onClick={() => void action({ action: "upload" })}
                >
                  {status.uploading ? "Uploading…" : "Upload now"}
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
            onClick={() => {
              void manage<Backup[]>({ action: "cloud-list" })
                .then(setCloud)
                .catch((e) => setError(String(e)));
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
            safety backup of the current database will be kept.
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
                  onRestored();
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
