import { useEffect, useRef, useState, type RefObject } from "react";
import { ImagePlus, Check, X } from "lucide-react";
import { appendTaskImage } from "../lib/touch-image.js";
import { Button } from "./ui/button.js";
import { getHost } from "../host.js";
import {
  getPlainText,
  setPlainText,
  setCaretOffset,
} from "../lib/content-editable-utils.js";

/** Explicit actions on touch hosts, where Cmd+Enter and blur are not reliable controls. */
export function TouchEditorActions({
  editor,
  onChange,
  onSave,
  onCancel,
  onError,
}: {
  editor: RefObject<HTMLDivElement | null>;
  onChange(value: string): void;
  onSave(): Promise<void>;
  onCancel(): void;
  onError(message: string): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!getHost().touch) return;
    const reveal = () =>
      requestAnimationFrame(() =>
        actionsRef.current?.scrollIntoView({ block: "nearest" }),
      );
    const timer = setTimeout(reveal, 300);
    window.visualViewport?.addEventListener("resize", reveal);
    return () => {
      clearTimeout(timer);
      window.visualViewport?.removeEventListener("resize", reveal);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  if (!getHost().touch) return null;
  return (
    <div
      ref={actionsRef}
      className="touch-editor-actions flex items-center gap-2 pt-2"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Attach image"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const reference = await getHost().saveImage(file);
            const el = editor.current;
            if (!el?.isConnected) return;
            const value = appendTaskImage(getPlainText(el), reference);
            setPlainText(el, value);
            onChange(value);
            el.focus();
            setCaretOffset(el, value.length);
          } catch (error) {
            onError(String(error));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        aria-label="Add image"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        <ImagePlus />
      </Button>
      <span className="flex-1" />
      <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
        <X /> Cancel
      </Button>
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Check /> {busy ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
