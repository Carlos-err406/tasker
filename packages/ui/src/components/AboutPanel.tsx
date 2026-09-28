import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, Download, RefreshCw } from "lucide-react";
import { Button } from "./ui/button.js";
import { PanelHeader } from "./PanelHeader.js";
import { GitHubLogo } from "./GitHubLogo.js";
const taskerLogo = new URL("../assets/tasker-logo.png", import.meta.url).href;
export interface UpdateStatus {
  currentVersion: string;
  version: string | null;
  phase:
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "unpublished"
    | "downloading"
    | "ready"
    | "permission"
    | "error";
  busy: boolean;
  progress: number;
  error: string | null;
}
function CreditLink({
  href,
  open,
  children,
}: {
  href: string;
  open: (url: string) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2"
      onClick={(event) => {
        event.preventDefault();
        void open(href).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}
export function AboutPanel({
  onClose,
  manage,
  platform,
  openExternal,
  backLabel = "Back to tasks",
}: {
  onClose: () => void;
  manage: (action: "status" | "check" | "install") => Promise<UpdateStatus>;
  platform: "Mac" | "Android";
  openExternal: (url: string) => Promise<void>;
  backLabel?: string;
}) {
  const [status, setStatus] = useState<UpdateStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const update = (value: UpdateStatus) => {
    if (mounted.current) {
      setStatus(value);
    }
  };
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await manage("status");
        if (active) update(value);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) timer = setTimeout(() => void poll(), 500);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [manage]);
  const run = async (action: "check" | "install") => {
    setBusy(true);
    setError("");
    try {
      update(await manage(action));
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const working = busy || status?.busy;
  const message =
    status?.phase === "checking"
      ? "Checking for updates…"
      : status?.phase === "downloading"
        ? `Downloading update… ${status.progress}%`
        : status?.phase === "available"
          ? `Tasker ${status.version} is available`
          : status?.phase === "current"
            ? "You’re up to date"
            : status?.phase === "unpublished"
              ? `No ${platform} update has been published yet.`
              : status?.phase === "permission"
                ? "Allow updates from Tasker in Android settings, then tap Install update."
                : status?.phase === "ready"
                  ? "Update downloaded. Confirm installation in Android’s installer."
                  : status?.phase === "error"
                    ? "Could not finish the update"
                    : "Check for a newer version of Tasker.";
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <PanelHeader
        title="About"
        icon={Info}
        onClose={onClose}
        backLabel={backLabel}
      />
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 p-4 text-sm">
        <div className="flex items-center gap-3">
          <img
            src={taskerLogo}
            alt="Tasker logo"
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-2xl"
          />
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Tasker</h3>
            <p className="mt-1 text-muted-foreground">
              Version {status?.currentVersion ?? "…"} · {platform}
            </p>
          </div>
        </div>
        <section className="space-y-2" aria-label="Updates">
          <h3 className="font-medium">Updates</h3>
          <p role="status">{message}</p>
          {(error || status?.error) && (
            <p role="alert" className="text-destructive">
              {error || status?.error}
            </p>
          )}
          <p className="text-muted-foreground">
            {platform === "Android"
              ? "Android asks you to confirm installation. Your tasks and settings are kept."
              : "Mac updates use Tasker’s installer. View an available release for installation instructions."}
          </p>
        </section>
        <section className="space-y-2" aria-label="Credits">
          <h3 className="font-medium">Credits</h3>
          <p>
            Created by{" "}
            <CreditLink
              href="https://github.com/Carlos-err406"
              open={openExternal}
            >
              Carlos
            </CreditLink>
            .
          </p>
          <p className="text-muted-foreground">
            Built with{" "}
            <CreditLink href="https://react.dev" open={openExternal}>
              React
            </CreditLink>
            ,{" "}
            <CreditLink href="https://www.sqlite.org" open={openExternal}>
              SQLite
            </CreditLink>
            ,{" "}
            <CreditLink href="https://ui.shadcn.com" open={openExternal}>
              shadcn/ui
            </CreditLink>{" "}
            and{" "}
            <CreditLink href="https://lucide.dev" open={openExternal}>
              Lucide
            </CreditLink>
            .
            {platform === "Mac" && (
              <>
                {" "}
                Menu bar powered by{" "}
                <CreditLink
                  href="https://github.com/Carlos-err406/SwiftBar"
                  open={openExternal}
                >
                  SwiftBar
                </CreditLink>
                .
              </>
            )}
          </p>
          <CreditLink
            href="https://github.com/Carlos-err406/tasker"
            open={openExternal}
          >
            <span className="inline-flex items-center gap-2">
              <GitHubLogo />
              Source code & releases
            </span>
          </CreditLink>
        </section>
      </div>
      <div className="shrink-0 flex flex-wrap gap-2 p-4 border-t border-border">
        <Button
          variant="outline"
          disabled={!!working}
          onClick={() => void run("check")}
        >
          <RefreshCw
            className={status?.phase === "checking" ? "animate-spin" : ""}
          />
          Check for updates
        </Button>
        {status?.version && (
          <Button disabled={!!working} onClick={() => void run("install")}>
            <Download />
            {status.phase === "downloading"
              ? `Downloading… ${status.progress}%`
              : status.phase === "ready" || status.phase === "permission"
                ? "Install update"
                : platform === "Mac"
                  ? `View update ${status.version}`
                  : `Update to ${status.version}`}
          </Button>
        )}
      </div>
    </section>
  );
}
