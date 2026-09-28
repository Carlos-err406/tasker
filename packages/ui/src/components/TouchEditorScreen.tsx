import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getHost } from "../host.js";

/** Touch editing gets its own screen while retaining the shared editor and save path. */
export function TouchEditorScreen({
  title,
  listName,
  onCancel,
  children,
}: {
  title: string;
  listName: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!getHost().touch) return;
    const root = document.getElementById("root");
    const wasInert = root?.inert;
    if (root) root.inert = true;
    return () => {
      if (root) root.inert = wasInert ?? false;
    };
  }, []);
  if (!getHost().touch) return <>{children}</>;
  return createPortal(
    <section
      ref={screen}
      className="mobile-shell touch-editor-screen"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Tab") {
          const controls = [
            ...screen.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), [contenteditable=true], input:not([hidden]):not(:disabled)",
            ),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="touch-editor-heading">
        <h1>{title}</h1>
        <p>{listName}</p>
      </header>
      <div className="touch-editor-body">{children}</div>
    </section>,
    document.body,
  );
}
