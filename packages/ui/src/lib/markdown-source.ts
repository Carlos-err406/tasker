/** Repair smart punctuation only in Markdown delimiter lines, retaining line numbers. */
export function normalizeMarkdownDelimiters(source: string): string {
  const lines = source.split('\n');
  let fence: { marker: string; length: number } | undefined;
  return lines.map((line, index) => {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (boundary) {
      const marker = boundary[1]!;
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length && !boundary[2]!.trim()) fence = undefined;
      return line;
    }
    // Preserve fenced/indented code and normal text, including prose with em dashes.
    if (fence || /^(?: {4}|\t)/.test(line) || !/[–—]/.test(line)) return line;
    if (/^ {0,3}[-–—]+[ \t]*$/.test(line)) return '---';
    if (!line.includes('|') || !lines[index - 1]?.includes('|')) return line;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (!cells.length || !cells.every(cell => /^:?[–—-]+:?$/.test(cell.trim()))) return line;
    return line.replace(/[–—-]+/g, '---');
  }).join('\n');
}
