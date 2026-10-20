/** A widget row's notes: Markdown reduced to plain text that reads the same. */
export function widgetNotes(preview: string | null): string | null {
  if (!preview) return null;
  const text = preview
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*] \[[xX]\]\s*/, "☑ ")
        .replace(/^\s*[-*] \[ \]\s*/, "☐ ")
        .replace(/^\s*[-*+] /, "• ")
        .replace(/^\s*>\s?/, "")
        .replace(/^#{1,6}\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => `🖼 ${alt || "image"}`)
        .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1")
        .replace(/(\*\*|__|~~|`)/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  return text || null;
}
