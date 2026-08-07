import { useState, useCallback, createContext, useContext, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
/** Minimal hast Element shape for accessing AST position info. */
interface HastElement { position?: { start: { line: number } } }
import { CheckSquare, Square, Loader2, Copy, Check, Play, Image as ImageIcon, ImageOff, Images, Video } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { openExternal } from "@/lib/services/window";

/** Context to pass the source line number from a task-list `<li>` to its checkbox `<input>`. */
const CheckboxLineCtx = createContext<number | null>(null);

type MediaKind = "image" | "video";

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

function resolveMediaSrc(src: string | undefined): string | undefined {
  return resolveImageSrc(src);
}

function isVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, "https://tasker.local");
    return /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(parsed.pathname);
  } catch {
    return /\.(mp4|webm|ogg|ogv|mov|m4v)(?:[?#].*)?$/i.test(url);
  }
}

interface YouTubePreviewData {
  videoId: string;
  thumbnailUrl: string;
}

function getYouTubePreviewData(url: string | undefined): YouTubePreviewData | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    let videoId: string | null = null;

    if (hostname === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed") {
        videoId = parts[1] ?? null;
      } else if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v");
      }
    }

    if (!videoId || !/^[\w-]{6,}$/.test(videoId)) return null;
    return {
      videoId,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

function MediaPreviewFrame({
  kind,
  label,
  defaultExpanded,
  children,
}: {
  kind: MediaKind;
  label?: string;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const [overrideExpanded, setOverrideExpanded] = useState<boolean | null>(null);
  const expanded = overrideExpanded ?? defaultExpanded;
  const Icon = kind === "image" ? ImageIcon : Video;
  const ExpandIcon = kind === "image" ? Images : Video;
  const noun = kind === "image" ? "image" : "video";

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid={`markdown-${kind}-preview-collapsed`}
        aria-label={`Show ${noun} preview`}
        onClick={(e) => {
          e.stopPropagation();
          setOverrideExpanded(true);
        }}
        className="my-1 flex w-full items-center gap-2 rounded border border-border/70 bg-muted/20 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/35 hover:text-foreground"
      >
        <Icon className="size-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label || `${noun[0]!.toUpperCase()}${noun.slice(1)} preview hidden`}</span>
        <ExpandIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
      </button>
    );
  }

  return (
    <span className="relative my-1 block w-full">
      {children}
      <button
        type="button"
        data-testid={`markdown-${kind}-preview-hide`}
        aria-label={`Hide ${noun} preview`}
        onClick={(e) => {
          e.stopPropagation();
          setOverrideExpanded(false);
        }}
        className="absolute right-1 top-1 z-20 flex size-6 items-center justify-center rounded bg-black/60 text-white opacity-0 shadow transition-opacity hover:bg-black/75 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-white/70 group-hover/media:opacity-100"
      >
        <ImageOff className="size-3.5" />
      </button>
    </span>
  );
}

function ImageWithContextMenu({ src, alt, showMediaPreviews }: { src?: string; alt?: string; showMediaPreviews: boolean }) {
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
        <span className="group/media block w-full" onContextMenu={(e) => e.stopPropagation()}>
          <MediaPreviewFrame kind="image" label={alt ? `Image: ${alt}` : undefined} defaultExpanded={showMediaPreviews}>
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
          </MediaPreviewFrame>
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

function DirectVideoPreview({ href, label }: { href: string; label?: string }) {
  const resolvedSrc = resolveMediaSrc(href);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <span
      data-testid="markdown-video-preview"
      className="relative block max-w-full overflow-hidden rounded border border-border bg-black"
    >
      {loading && !error && (
        <span
          data-testid="markdown-video-loading"
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/70 text-[11px] text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          Loading video...
        </span>
      )}
      {error && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openExternal(href);
          }}
          className="flex min-h-28 w-full flex-col items-center justify-center gap-1 bg-muted/40 px-3 py-4 text-center text-[11px] text-muted-foreground hover:text-foreground"
        >
          <span>Could not load video preview</span>
          <span className="underline">Open video</span>
        </button>
      )}
      {!error && (
        <video
          src={resolvedSrc}
          controls
          preload="metadata"
          aria-label={label || "Video preview"}
          onLoadedMetadata={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          onClick={(e) => e.stopPropagation()}
          className="block max-h-64 max-w-full bg-black"
        />
      )}
    </span>
  );
}

function YouTubePreview({ href, preview, label }: { href: string; preview: YouTubePreviewData; label?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      data-testid="markdown-video-preview"
      aria-label={label ? `Open ${label} on YouTube` : "Open video on YouTube"}
      onClick={(e) => {
        e.stopPropagation();
        openExternal(href);
      }}
      className="group relative block aspect-video w-full max-w-full overflow-hidden rounded border border-border bg-muted/40 text-left"
    >
      {loading && !error && (
        <span
          data-testid="markdown-video-loading"
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-[11px] text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          Loading YouTube preview...
        </span>
      )}
      {error ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-muted-foreground group-hover:text-foreground">
          <Play className="size-7 rounded-full border border-muted-foreground/50 p-1.5" />
          <span>Preview unavailable</span>
          <span className="underline">Open on YouTube</span>
        </span>
      ) : (
        <img
          src={preview.thumbnailUrl}
          alt=""
          data-testid="markdown-video-thumbnail"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          className={`h-full w-full object-cover transition-opacity ${loading ? "opacity-0" : "opacity-80 group-hover:opacity-100"}`}
        />
      )}
      {!error && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/10">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/70 text-white shadow">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </span>
      )}
      <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-[11px] font-medium text-white">
        Open on YouTube
      </span>
    </button>
  );
}

function VideoPreviewWithContextMenu({
  href,
  label,
  youtubePreview,
  showMediaPreviews,
}: {
  href: string;
  label?: string;
  youtubePreview?: YouTubePreviewData;
  showMediaPreviews: boolean;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className="group/media block w-full" onContextMenu={(e) => e.stopPropagation()}>
          <MediaPreviewFrame kind="video" label={label ? `Video: ${label}` : undefined} defaultExpanded={showMediaPreviews}>
            {youtubePreview
              ? <YouTubePreview href={href} preview={youtubePreview} label={label} />
              : <DirectVideoPreview href={href} label={label} />}
          </MediaPreviewFrame>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={8}>
        <ContextMenuItem onSelect={() => openExternal(href)}>
          Open video
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => navigator.clipboard.writeText(href)}>
          Copy video URL
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

function LinkWithContextMenu({
  href,
  children,
  showMediaPreviews,
}: {
  href?: string;
  children?: ReactNode;
  showMediaPreviews: boolean;
}) {
  const textContent = getTextContent(children);
  const youtubePreview = getYouTubePreviewData(href);

  if (href && (isVideoUrl(href) || youtubePreview)) {
    return <VideoPreviewWithContextMenu href={href} label={textContent} youtubePreview={youtubePreview ?? undefined} showMediaPreviews={showMediaPreviews} />;
  }

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
  showMediaPreviews?: boolean;
}

export function MarkdownContent({ content, onToggleCheckbox, showMediaPreviews = true }: MarkdownContentProps) {
  // Normalize non-breaking spaces (\u00A0) to regular spaces so markdown
  // parsers recognize indentation for nested lists.
  const processed = preprocessCheckboxes(content.replace(/\u00A0/g, ' '));

  // Build components with dynamic li/input that use context for checkbox line identification.
  // The li component reads its AST source line and provides it via context;
  // the input component consumes the context to know which checkbox it represents.
  const components: Components = {
    img: ({ src, alt }) => <ImageWithContextMenu src={src} alt={alt} showMediaPreviews={showMediaPreviews} />,
    table: ({ children }) => <table className="w-full">{children}</table>,
    th: ({ children }) => <th className="border p-1 border-border">{children}</th>,
    td: ({ children }) => <td className="border p-1 border-border">{children}</td>,
    a: ({ href, children }) => <LinkWithContextMenu href={href} showMediaPreviews={showMediaPreviews}>{children}</LinkWithContextMenu>,
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
