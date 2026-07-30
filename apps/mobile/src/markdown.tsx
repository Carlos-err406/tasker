/**
 * Lightweight markdown renderer for React Native.
 * Supports: **bold**, *italic*, `inline code`, ~~strikethrough~~,
 * [links](url), ```code blocks```, - [ ] checkboxes, # headings
 */

import { memo, useState, type ReactElement } from 'react';
import { Text, View, Image, ActivityIndicator, StyleSheet, Linking } from 'react-native';

const C = {
  text: '#fafafa',
  muted: '#71717a',
  dim: '#52525b',
  blue: '#3b82f6',
  code: '#27272a',
  green: '#4ade80',
};

interface MarkdownProps {
  content: string;
  style?: any;
}

type Segment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strike'; text: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'image'; alt: string; url: string }
  | { type: 'checkbox'; checked: boolean };

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  // Pattern matches: **bold**, *italic*, `code`, ~~strike~~, ![alt](url), [text](url), [ ]/[x]
  // URLs use balanced parens matching to handle URLs containing ) like encoded paths
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|!\[([^\]]*)\]\(((?:[^()]*|\([^()]*\))*)\)|\[([^\]]+)\]\(((?:[^()]*|\([^()]*\))*)\)|\[([ xX])\]/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'text', text: text.slice(last, match.index) });
    }
    if (match[1] != null) segments.push({ type: 'bold', text: match[1] });
    else if (match[2] != null) segments.push({ type: 'italic', text: match[2] });
    else if (match[3] != null) segments.push({ type: 'code', text: match[3] });
    else if (match[4] != null) segments.push({ type: 'strike', text: match[4] });
    else if (match[5] != null && match[6] != null) segments.push({ type: 'image', alt: match[5], url: match[6] });
    else if (match[7] != null && match[8] != null) segments.push({ type: 'link', text: match[7], url: match[8] });
    else if (match[9] != null) segments.push({ type: 'checkbox', checked: match[9].toLowerCase() === 'x' });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: 'text', text: text.slice(last) });
  }
  return segments;
}

function InlineSegment({ segment }: { segment: Segment }) {
  switch (segment.type) {
    case 'text':
      return <Text>{segment.text}</Text>;
    case 'bold':
      return <Text style={ms.bold}>{segment.text}</Text>;
    case 'italic':
      return <Text style={ms.italic}>{segment.text}</Text>;
    case 'code':
      return <Text style={ms.inlineCode}>{segment.text}</Text>;
    case 'strike':
      return <Text style={ms.strike}>{segment.text}</Text>;
    case 'link':
      return (
        <Text style={ms.link} onPress={() => Linking.openURL(segment.url)}>
          {segment.text}
        </Text>
      );
    case 'image':
      return null; // Images are rendered as block elements, not inline
    case 'checkbox':
      return <Text style={segment.checked ? ms.checkboxChecked : ms.checkbox}>{segment.checked ? '☑ ' : '☐ '}</Text>;
  }
}

function InlineLine({ text }: { text: string }) {
  const segments = parseInline(text);
  return (
    <Text>
      {segments.map((seg, i) => (
        <InlineSegment key={i} segment={seg} />
      ))}
    </Text>
  );
}

// ─── GFM tables ──────────────────────────────────────────────────────────────

/** Split a `| a | b |` row into trimmed cells (leading/trailing pipes optional). */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** A delimiter row: every cell is dashes with optional alignment colons, e.g. `---`, `:--`, `--:`. */
function isTableDelimiter(line: string): boolean {
  if (!line.includes('|') && !line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function MarkdownTable({ header, rows }: { header: string[]; rows: string[][] }) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
  return (
    <View style={ms.table}>
      <View style={[ms.tableRow, ms.tableHeaderRow]}>
        {pad(header).map((cell, i) => (
          <View key={i} style={ms.tableCell}>
            <Text style={ms.tableHeaderText}><InlineLine text={cell} /></Text>
          </View>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={ms.tableRow}>
          {pad(row).map((cell, c) => (
            <View key={c} style={ms.tableCell}>
              <Text style={ms.tableCellText}><InlineLine text={cell} /></Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function MarkdownImage({ url, alt }: { url: string; alt: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return error ? (
    <Text style={ms.imageFail}>Failed to load image</Text>
  ) : (
    <View>
      {loading && (
        <View style={ms.imageLoader}>
          <ActivityIndicator size="small" color="#71717a" />
        </View>
      )}
      <Image
        source={{ uri: url }}
        alt={alt}
        style={[ms.image, size ? { aspectRatio: size.width / size.height } : { height: 150 }, loading && { height: 0 }]}
        resizeMode="contain"
        onLoad={(e) => {
          const { width, height } = e.nativeEvent.source;
          if (width && height) setSize({ width, height });
          setLoading(false);
        }}
        onError={() => { setLoading(false); setError(true); }}
      />
    </View>
  );
}

export const Markdown = memo(function Markdown({ content, style }: MarkdownProps) {
  const lines = content.split('\n');
  const elements: ReactElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Image on its own line: ![alt](url)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(((?:[^()]*|\([^()]*\))*)\)\s*$/);
    if (imgMatch) {
      elements.push(<MarkdownImage key={`img-${i}`} url={imgMatch[2]!} alt={imgMatch[1]!} />);
      i++;
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <View key={`code-${i}`} style={ms.codeBlock}>
          <Text style={ms.codeText}>{codeLines.join('\n')}</Text>
        </View>,
      );
      continue;
    }

    // Heading
    if (line.startsWith('# ')) {
      elements.push(<Text key={`h-${i}`} style={ms.heading}>{line.slice(2)}</Text>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<Text key={`h-${i}`} style={ms.heading}>{line.slice(3)}</Text>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<View key={`hr-${i}`} style={ms.hr} />);
      i++;
      continue;
    }

    // List item (- or *)
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      const text = line.replace(/^\s*[-*]\s/, '');
      elements.push(
        <View key={`li-${i}`} style={[ms.listItem, { paddingLeft: 8 + indent * 8 }]}>
          <Text style={ms.bullet}>•</Text>
          <Text style={ms.listText}><InlineLine text={text} /></Text>
        </View>,
      );
      i++;
      continue;
    }

    // GFM table: a header row followed by a delimiter row (|---|---|)
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1]!)) {
      const header = splitTableRow(line);
      i += 2; // consume header + delimiter
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
        rows.push(splitTableRow(lines[i]!));
        i++;
      }
      elements.push(<MarkdownTable key={`tbl-${i}`} header={header} rows={rows} />);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <Text key={`p-${i}`} style={ms.para}>
        <InlineLine text={line} />
      </Text>,
    );
    i++;
  }

  return <View style={style}>{elements}</View>;
});

const ms = StyleSheet.create({
  bold: { fontWeight: '700', color: C.text },
  italic: { fontStyle: 'italic' },
  inlineCode: { fontFamily: 'monospace', fontSize: 11, backgroundColor: C.code, color: C.muted, paddingHorizontal: 3, borderRadius: 3 },
  strike: { textDecorationLine: 'line-through', color: C.dim },
  link: { color: C.blue, textDecorationLine: 'underline' },
  checkbox: { fontSize: 14, color: C.dim },
  checkboxChecked: { fontSize: 14, color: C.green },
  codeBlock: { backgroundColor: C.code, borderRadius: 6, padding: 8, marginVertical: 4 },
  codeText: { fontFamily: 'monospace', fontSize: 11, color: C.muted },
  heading: { fontWeight: '700', color: C.text, marginTop: 4 },
  hr: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#27272a', marginVertical: 4 },
  listItem: { flexDirection: 'row', gap: 4, marginTop: 1 },
  bullet: { color: C.dim, fontSize: 12, lineHeight: 18 },
  listText: { flex: 1, color: C.muted, fontSize: 12, lineHeight: 18 },
  para: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#27272a', borderRadius: 6, marginVertical: 4, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableHeaderRow: { backgroundColor: '#18181b' },
  tableCell: { flex: 1, paddingHorizontal: 6, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#27272a' },
  tableHeaderText: { color: C.text, fontWeight: '700', fontSize: 11 },
  tableCellText: { color: C.muted, fontSize: 11 },
  image: { width: '100%', borderRadius: 6, marginVertical: 4 } as any,
  imageLoader: { height: 80, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: '#18181b', borderRadius: 6, marginVertical: 4 },
  imageFail: { color: C.dim, fontSize: 10, marginVertical: 4 },
});
