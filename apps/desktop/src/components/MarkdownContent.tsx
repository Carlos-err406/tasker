import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import { CheckSquare, Square } from "lucide-react";
import { openExternal } from "@/lib/services/window";

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return src;
  // Decode first (e.g. %20 → space), then re-encode for the protocol URL
  const decoded = decodeURIComponent(src);
  if (decoded.startsWith("~/")) return `local-file://${encodeURI(window.ipc.homePath + decoded.slice(1))}`;
  if (decoded.startsWith("/")) return `local-file://${encodeURI(decoded)}`;
  return src;
}

const components: Components = {
  img: ({ src, alt }) => {
    const resolvedSrc = resolveImageSrc(src);
    return (
      <span className="block w-full my-1">
        <img
          src={resolvedSrc}
          alt={alt ?? ""}
          onClick={(e) => {
            e.stopPropagation();
            if (src) openExternal(src);
          }}
          className="max-w-full h-auto mx-auto block rounded cursor-pointer"
        />
      </span>
    );
  },
  table: ({ children }) => <table className="w-full">{children}</table>,
  th: ({ children }) => (
    <th className="border p-1 border-border">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border p-1 border-border">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (href) openExternal(href);
      }}
      className="text-blue-400 hover:underline break-all"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground/80">{children}</strong>
  ),
  em: ({ children }) => <em>{children}</em>,
  code: ({ children }) => (
    <code className="bg-muted/50 rounded px-1 py-0.5 text-[10px] font-mono">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted/50 rounded px-1.5 py-1 text-[10px] font-mono whitespace-pre overflow-x-auto my-0.5">
      {children}
    </pre>
  ),
  h1: ({ children }) => (
    <div className="font-semibold text-foreground/80 mt-1 first:mt-0">
      {children}
    </div>
  ),
  h2: ({ children }) => (
    <div className="font-semibold text-foreground/80 mt-1 first:mt-0">
      {children}
    </div>
  ),
  h3: ({ children }) => (
    <div className="font-semibold text-foreground/80 mt-1 first:mt-0">
      {children}
    </div>
  ),
  hr: () => <hr className="border-t border-border my-1" />,
  ul: ({ children, className }) => {
    const isTaskList = className?.includes("contains-task-list");
    return <ul className={isTaskList ? "list-none [&_ul]:pl-3" : "list-disc pl-4"}>{children}</ul>;
  },
  ol: ({ children }) => (
    <ol className="list-decimal pl-4">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  p: ({ children }) => (
    <p className="my-0.5 first:mt-0 last:mb-0 whitespace-pre-wrap">{children}</p>
  ),
  input: ({ checked }) =>
    checked ? (
      <CheckSquare className="size-4 mr-1 inline align-middle" />
    ) : (
      <Square className="size-4 mr-1 inline align-middle" />
    ),
};

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
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const processed = preprocessCheckboxes(content);
  return (
    <div className="text-[11px] text-muted-foreground mt-0.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
