import { useState, useCallback, createContext, useContext, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
/** Minimal hast Element shape for accessing AST position info. */
interface HastElement { position?: { start: { line: number } } }
import { CheckSquare, Square, Loader2, Copy, Check } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { openExternal } from "@/lib/services/window";

/** Context to pass the source line number from a task-list `<li>` to its checkbox `<input>`. */
const CheckboxLineCtx = createContext<number | null>(null);

function getTextContent(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (typeof node === "object" && "props" in node) return getTextContent((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return src;
  // Decode first (e.g. %20 → space), then re-encode for the protocol URL
  const decoded = decodeURIComponent(src);
  if (decoded.startsWith("~/")) return `local-file://${encodeURI(window.ipc.homePath + decoded.slice(1))}`;
  if (decoded.startsWith("/")) return `local-file://${encodeURI(decoded)}`;
  return src;
}

function ImageWithContextMenu({ src, alt }: { src?: string; alt?: string }) {
  const resolvedSrc = resolveImageSrc(src);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleCopyImage = useCallback(async () => {
    if (!resolvedSrc) return;
    try {
      const response = await fetch(resolvedSrc);
      const blob = await response.blob();
      const pngBlob = blob.type === "image/png" ? blob : await createPngBlob(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    } catch { /* clipboard write may fail silently */ }
  }, [resolvedSrc]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className="block w-full my-1" onContextMenu={(e) => e.stopPropagation()}>
          {loading && !error && (
            <span className="flex items-center justify-center py-3 text-muted-foreground/50">
              <Loader2 className="size-4 animate-spin" />
            </span>
          )}
          {error ? (
            <span className="flex items-center justify-center py-2 text-muted-foreground/40 text-[10px]">
              Failed to load image
            </span>
          ) : (
            <img
              src={resolvedSrc}
              alt={alt ?? ""}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError(true); }}
              onClick={(e) => {
                e.stopPropagation();
                if (src) openExternal(src);
              }}
              className={`max-w-full h-auto mx-auto block rounded cursor-pointer ${loading ? "hidden" : ""}`}
            />
          )}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={8}>
        <ContextMenuItem onSelect={() => { if (src) openExternal(src); }}>
          Open image
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { if (src) navigator.clipboard.writeText(src); }}>
          Copy image path
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleCopyImage}>
          Copy image
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

async function createPngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

function LinkWithContextMenu({ href, children }: { href?: string; children?: ReactNode }) {
  const textContent = getTextContent(children);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (href) openExternal(href);
          }}
          onContextMenu={(e) => e.stopPropagation()}
          className="text-blue-400 hover:underline break-all"
        >
          {children}
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={8}>
        <ContextMenuItem onSelect={() => { if (href) openExternal(href); }}>
          Open link
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { if (href) navigator.clipboard.writeText(href); }}>
          Copy link
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => navigator.clipboard.writeText(textContent)}>
          Copy link text
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CopyableCodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = getTextContent(children);

  const copyText = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <pre
          onClick={(e) => { e.stopPropagation(); copyText(); }}
          onContextMenu={(e) => e.stopPropagation()}
          className="bg-muted/50 rounded px-1.5 py-1 text-[10px] font-mono whitespace-pre overflow-x-auto my-0.5 cursor-pointer relative group [&_code]:bg-transparent [&_code]:p-0"
        >
          {children}
          <span className="absolute top-0.5 right-1 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </span>
        </pre>
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={8}>
        <ContextMenuItem onSelect={copyText}>
          Copy code
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Convert standalone `[ ]` / `[x]` / `[X]` checkboxes into list-item checkboxes
 *  so react-markdown (via remark-gfm) renders them as proper checkboxes.
 *  Skips lines already in a list (`- [ ]`, `* [ ]`, `1. [ ]`). */
function preprocessCheckboxes(text: string): string {
  return text.replace(
    /^(\s*)(\[[ xX]\])/gm,
    (match, indent: string, checkbox: string, offset: number) => {
      // Look backwards to see if there's a list marker before the checkbox on this line
      const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
      const prefix = text.slice(lineStart, offset);
      if (/[-*]\s+$/.test(prefix) || /\d+[.)]\s+$/.test(prefix)) return match;
      return `${indent}- ${checkbox}`;
    },
  );
}

interface MarkdownContentProps {
  content: string;
  /** Called with the line number (within `content`) of the toggled checkbox. */
  onToggleCheckbox?: (contentLineNumber: number) => void;
}

export function MarkdownContent({ content, onToggleCheckbox }: MarkdownContentProps) {
  const processed = preprocessCheckboxes(content);

  // Build components with dynamic li/input that use context for checkbox line identification.
  // The li component reads its AST source line and provides it via context;
  // the input component consumes the context to know which checkbox it represents.
  const components: Components = {
    img: ({ src, alt }) => <ImageWithContextMenu src={src} alt={alt} />,
    table: ({ children }) => <table className="w-full">{children}</table>,
    th: ({ children }) => <th className="border p-1 border-border">{children}</th>,
    td: ({ children }) => <td className="border p-1 border-border">{children}</td>,
    a: ({ href, children }) => <LinkWithContextMenu href={href}>{children}</LinkWithContextMenu>,
    strong: ({ children }) => <strong className="font-semibold text-foreground/80">{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    code: ({ children }) => (
      <code className="bg-muted/50 rounded px-1 py-0.5 text-[10px] font-mono">{children}</code>
    ),
    pre: ({ children }) => <CopyableCodeBlock>{children}</CopyableCodeBlock>,
    h1: ({ children }) => <div className="font-semibold text-foreground/80 mt-1 first:mt-0">{children}</div>,
    h2: ({ children }) => <div className="font-semibold text-foreground/80 mt-1 first:mt-0">{children}</div>,
    h3: ({ children }) => <div className="font-semibold text-foreground/80 mt-1 first:mt-0">{children}</div>,
    hr: () => <hr className="border-t border-border my-1" />,
    ul: ({ children, className }) => {
      const isTaskList = className?.includes("contains-task-list");
      return <ul className={isTaskList ? "list-none [&_ul]:pl-3" : "list-disc pl-4"}>{children}</ul>;
    },
    ol: ({ children }) => <ol className="list-decimal pl-4">{children}</ol>,
    li: ({ children, className, node }) => {
      const isTask = typeof className === "string" && className.includes("task-list-item");
      // AST line is 1-based; convert to 0-based content line
      const sourceLine = isTask && (node as HastElement | undefined)?.position?.start?.line != null
        ? (node as HastElement).position!.start.line - 1
        : null;
      if (sourceLine != null) {
        return (
          <CheckboxLineCtx.Provider value={sourceLine}>
            <li>{children}</li>
          </CheckboxLineCtx.Provider>
        );
      }
      return <li>{children}</li>;
    },
    p: ({ children }) => (
      <p className="my-0.5 first:mt-0 last:mb-0 whitespace-pre-wrap">{children}</p>
    ),
    input: function CheckboxInput({ checked }: { checked?: boolean }) {
      const contentLine = useContext(CheckboxLineCtx);
      const Icon = checked ? CheckSquare : Square;
      const interactive = onToggleCheckbox && contentLine != null;
      return (
        <Icon
          className={`size-4 mr-1 inline align-middle ${interactive ? "cursor-pointer hover:text-foreground transition-colors" : ""}`}
          onClick={interactive ? (e) => {
            e.stopPropagation();
            onToggleCheckbox(contentLine);
          } : undefined}
        />
      );
    },
  };

  return (
    <div className="text-[11px] text-muted-foreground mt-0.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
