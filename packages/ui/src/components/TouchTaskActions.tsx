import { useRef, useState, type ReactNode } from "react";
import {
  Ellipsis,
  ChevronRight,
  Check,
  Paperclip,
  ImageOff,
} from "lucide-react";
import {
  TaskMediaActionsContext,
  type TaskMenuAction,
} from "./task-menu-actions.js";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog.js";
import { getHost } from "../host.js";

function ImageThumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
    >
      {failed ? (
        <ImageOff />
      ) : (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function TouchTaskActions({
  children,
  title,
  shortId,
  actions,
  onClosed,
}: {
  children: ReactNode;
  title: string;
  shortId: string;
  actions: TaskMenuAction[];
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<TaskMenuAction[]>([]);
  const mediaRegistry = useRef(new Map<string, TaskMenuAction>());
  const [mediaActions, setMediaActions] = useState<TaskMenuAction[]>([]);
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const gesture = useRef<{
    x: number;
    y: number;
    horizontal: boolean;
    startedAt: number;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const suppressClickUntil = useRef(0);
  if (!getHost().touch) return <>{children}</>;
  const reveal = () => {
    setPath([]);
    setMediaActions([...mediaRegistry.current.values()]);
    setOpen(true);
  };
  const reset = () => {
    gesture.current = null;
    setOffset(0);
  };
  const current = path.at(-1);
  const visibleActions: TaskMenuAction[] = current?.children ?? [
    ...actions.filter((action) => !action.destructive),
    ...(mediaActions.length
      ? [
          {
            label: "Content actions",
            icon: <Paperclip />,
            children: mediaActions,
          },
        ]
      : []),
    ...actions.filter((action) => action.destructive),
  ];
  return (
    <TaskMediaActionsContext.Provider value={mediaRegistry.current}>
      <div
        className="touch-task-row"
        onPointerDownCapture={(event) => {
          // React portals bubble through this row too; editors and dialogs are
          // separate surfaces. Every target physically inside the row can swipe.
          if (!event.currentTarget.contains(event.target as Node)) return;
          suppressClickUntil.current = 0;
          if (event.pointerType !== "touch" || !event.isPrimary) return;
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            horizontal: false,
            startedAt: Date.now(),
          };
        }}
        onPointerMoveCapture={(event) => {
          const start = gesture.current;
          if (!start) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (!start.horizontal) {
            if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
              reset();
              return;
            }
            if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            start.horizontal = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          setOffset(Math.max(-64, Math.min(64, dx * 0.5)));
        }}
        onPointerUpCapture={(event) => {
          const start = gesture.current;
          if (start?.horizontal) {
            // A drag must never become a tap on the checkbox, link, preview,
            // or other control underneath, even below the reveal threshold.
            suppressClickUntil.current = Date.now() + 400;
            if (Math.abs(event.clientX - start.x) >= 64) reveal();
          } else if (start && Date.now() - start.startedAt >= 500) {
            suppressClickUntil.current = Date.now() + 400;
          }
          reset();
        }}
        onPointerCancelCapture={reset}
        onClickCapture={(event) => {
          if (
            event.currentTarget.contains(event.target as Node) &&
            Date.now() < suppressClickUntil.current
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onContextMenuCapture={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return;
          event.preventDefault();
          event.stopPropagation();
          reset();
          suppressClickUntil.current = Infinity;
        }}
      >
        <div
          className="touch-task-content"
          style={{
            transform: offset ? `translateX(${offset}px)` : undefined,
            transition: offset ? "none" : undefined,
          }}
        >
          {children}
          <Button
            variant="ghost"
            size="icon"
            className="touch-task-actions-trigger"
            aria-label={`Task actions ${shortId}`}
            onClick={reveal}
          >
            <Ellipsis />
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="touch-task-sheet"
          showCloseButton={false}
          overlayClassName="touch-task-sheet-overlay"
          onCloseAutoFocus={(event) => {
            const action = pendingAction.current;
            pendingAction.current = undefined;
            if (action) event.preventDefault();
            action?.();
            onClosed?.();
          }}
        >
          <DialogHeader>
            <DialogTitle>{current?.label ?? "Task actions"}</DialogTitle>
            <DialogDescription className="break-words">
              {title}
            </DialogDescription>
          </DialogHeader>
          <div className="touch-task-sheet-actions">
            {visibleActions.map((action, index) => (
              <Button
                key={`${action.label}-${index}`}
                variant="ghost"
                disabled={action.disabled}
                aria-pressed={action.selected}
                className={action.destructive ? "text-destructive" : undefined}
                onClick={() => {
                  if (action.children) {
                    setPath((previous) => [...previous, action]);
                    return;
                  }
                  if (action.deferUntilClosed)
                    pendingAction.current = action.onSelect;
                  else action.onSelect?.();
                  setOpen(false);
                }}
              >
                {action.imagePreview ? (
                  <ImageThumbnail
                    key={action.imagePreview}
                    src={action.imagePreview}
                  />
                ) : (
                  action.icon
                )}
                <span className="flex-1 text-left">{action.label}</span>
                {action.selected && <Check />}
                {action.children && <ChevronRight />}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() =>
              path.length
                ? setPath((previous) => previous.slice(0, -1))
                : setOpen(false)
            }
          >
            {path.length ? "Back" : "Cancel"}
          </Button>
        </DialogContent>
      </Dialog>
    </TaskMediaActionsContext.Provider>
  );
}
