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
        // Attached images show as thumbnails; web images can't load in the widget.
        .replace(/!\[[^\]]*\]\(\/attachments\/[^)]*\)/g, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => `🖼 ${alt || "image"}`)
        .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1")
        .replace(/(\*\*|__|~~|`)/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  return text || null;
}

/** The first attached images in a task, for the widget's thumbnails. */
export function widgetImages(description: string): string[] {
  return [
    ...new Set(
      [...description.matchAll(/!\[[^\]]*\]\(\/attachments\/([a-f0-9-]{36})\)/g)].map(
        (m) => m[1]!,
      ),
    ),
  ].slice(0, 3);
}
