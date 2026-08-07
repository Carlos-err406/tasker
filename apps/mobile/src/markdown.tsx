/**
 * Lightweight markdown renderer for React Native.
 * Supports: **bold**, *italic*, `inline code`, ~~strikethrough~~,
 * [links](url), ```code blocks```, - [ ] checkboxes, # headings
 */

import { memo, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Text, View, Image, ActivityIndicator, StyleSheet, Linking, Pressable } from 'react-native';
import { Image as ImageIcon, ImageOff, Images, Play, Video } from 'lucide-react-native';

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
  showMediaPreviews?: boolean;
  mediaPreviewScope?: string;
  mediaPreviewResetSignal?: number;
}

type MediaKind = 'image' | 'video';
type MediaPreviewOverride = { expanded: boolean; resetSignal: number };

const mediaPreviewOverrides = new Map<string, MediaPreviewOverride>();

interface YouTubePreviewData {
  videoId: string;
  thumbnailUrl: string;
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

function isVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(parsed.pathname);
  } catch {
    return /\.(mp4|webm|ogg|ogv|mov|m4v)(?:[?#].*)?$/i.test(url);
  }
}

function getYouTubePreviewData(url: string | undefined): YouTubePreviewData | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    let videoId: string | null = null;

    if (hostname === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        videoId = parts[1] ?? null;
      } else if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
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

function getFirstMediaLink(text: string): { url: string; label?: string; youtube?: YouTubePreviewData; isVideo: boolean } | null {
  const markdownLink = text.match(/\[([^\]]+)\]\(((?:[^()]*|\([^()]*\))*)\)/);
  if (markdownLink) {
    const url = markdownLink[2]!;
    const youtube = getYouTubePreviewData(url);
    if (youtube || isVideoUrl(url)) return { url, label: markdownLink[1]!, youtube: youtube ?? undefined, isVideo: true };
  }

  const bareUrl = text.match(/https?:\/\/[^\s)]+/);
  if (!bareUrl) return null;
  const url = bareUrl[0];
  const youtube = getYouTubePreviewData(url);
  if (youtube || isVideoUrl(url)) return { url, label: youtube ? 'YouTube video' : 'Video', youtube: youtube ?? undefined, isVideo: true };
  return null;
}

function MediaPreviewFrame({
  kind,
  label,
  defaultExpanded,
  previewKey,
  resetSignal,
  children,
}: {
  kind: MediaKind;
  label?: string;
  defaultExpanded: boolean;
  previewKey: string;
  resetSignal: number;
  children: ReactNode;
}) {
  const [overrideExpanded, setOverrideExpanded] = useState<boolean | null>(() => {
    const saved = mediaPreviewOverrides.get(previewKey);
    return saved?.resetSignal === resetSignal ? saved.expanded : null;
  });
  const didMountRef = useRef(false);
  const expanded = overrideExpanded ?? defaultExpanded;
  const Icon = kind === 'image' ? ImageIcon : Video;
  const ExpandIcon = kind === 'image' ? Images : Video;
  const noun = kind === 'image' ? 'image' : 'video';

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    mediaPreviewOverrides.delete(previewKey);
    setOverrideExpanded(null);
  }, [previewKey, resetSignal]);

  const setExplicitExpanded = useCallback((next: boolean) => {
    mediaPreviewOverrides.set(previewKey, { expanded: next, resetSignal });
    setOverrideExpanded(next);
  }, [previewKey, resetSignal]);

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show ${noun} preview`}
        onPress={() => setExplicitExpanded(true)}
        style={ms.mediaCollapsed}
      >
        <Icon size={14} color={C.muted} />
        <Text style={ms.mediaCollapsedText} numberOfLines={1}>{label || `${noun[0]!.toUpperCase()}${noun.slice(1)} preview hidden`}</Text>
        <ExpandIcon size={14} color={C.dim} />
      </Pressable>
    );
  }

  return (
    <View style={ms.mediaFrame}>
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Hide ${noun} preview`}
        onPress={() => setExplicitExpanded(false)}
        style={ms.mediaHideButton}
      >
        <ImageOff size={14} color="#fff" />
      </Pressable>
    </View>
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

function MarkdownImage({
  url,
  alt,
  showMediaPreviews,
  previewScope,
  resetSignal,
}: {
  url: string;
  alt: string;
  showMediaPreviews: boolean;
  previewScope: string;
  resetSignal: number;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <MediaPreviewFrame
      kind="image"
      label={alt ? `Image: ${alt}` : undefined}
      defaultExpanded={showMediaPreviews}
      previewKey={`${previewScope}:image:${url}`}
      resetSignal={resetSignal}
    >
      {error ? (
        <Text style={ms.imageFail}>Failed to load image</Text>
      ) : (
        <Pressable onPress={() => Linking.openURL(url)}>
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
        </Pressable>
      )}
    </MediaPreviewFrame>
  );
}

function MarkdownVideoPreview({
  url,
  label,
  youtube,
  showMediaPreviews,
  previewScope,
  resetSignal,
}: {
  url: string;
  label?: string;
  youtube?: YouTubePreviewData;
  showMediaPreviews: boolean;
  previewScope: string;
  resetSignal: number;
}) {
  const [loading, setLoading] = useState(!!youtube);
  const [error, setError] = useState(false);

  return (
    <MediaPreviewFrame
      kind="video"
      label={label ? `Video: ${label}` : undefined}
      defaultExpanded={showMediaPreviews}
      previewKey={`${previewScope}:video:${url}`}
      resetSignal={resetSignal}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={youtube ? 'Open video on YouTube' : 'Open video'}
        onPress={() => Linking.openURL(url)}
        style={youtube ? ms.youtubeCard : ms.videoCard}
      >
        {youtube ? (
          <>
            {loading && !error && (
              <View style={ms.videoLoader}>
                <ActivityIndicator size="small" color="#71717a" />
                <Text style={ms.videoLoaderText}>Loading YouTube preview...</Text>
              </View>
            )}
            {error ? (
              <View style={ms.videoFallback}>
                <Play size={26} color={C.muted} />
                <Text style={ms.videoFallbackText}>Preview unavailable</Text>
                <Text style={ms.videoLinkText}>Open on YouTube</Text>
              </View>
            ) : (
              <Image
                source={{ uri: youtube.thumbnailUrl }}
                style={[ms.youtubeImage, loading && { opacity: 0 }]}
                resizeMode="cover"
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setError(true); }}
              />
            )}
            {!error && (
              <View style={ms.playOverlay}>
                <View style={ms.playButton}><Play size={20} color="#fff" fill="#fff" /></View>
              </View>
            )}
            <View style={ms.youtubeLabel}><Text style={ms.youtubeLabelText}>Open on YouTube</Text></View>
          </>
        ) : (
          <>
            <Video size={16} color={C.muted} />
            <Text style={ms.videoCardText} numberOfLines={1}>{label || url}</Text>
            <Text style={ms.videoLinkText}>Open</Text>
          </>
        )}
      </Pressable>
    </MediaPreviewFrame>
  );
}

export const Markdown = memo(function Markdown({
  content,
  style,
  showMediaPreviews = true,
  mediaPreviewScope = 'global',
  mediaPreviewResetSignal = 0,
}: MarkdownProps) {
  const lines = content.split('\n');
  const elements: ReactElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Image on its own line: ![alt](url)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(((?:[^()]*|\([^()]*\))*)\)\s*$/);
    if (imgMatch) {
      elements.push(
        <MarkdownImage
          key={`img-${i}`}
          url={imgMatch[2]!}
          alt={imgMatch[1]!}
          showMediaPreviews={showMediaPreviews}
          previewScope={mediaPreviewScope}
          resetSignal={mediaPreviewResetSignal}
        />,
      );
      i++;
      continue;
    }

    const mediaLink = getFirstMediaLink(line);
    if (mediaLink) {
      const mediaOnly = line.trim() === mediaLink.url || line.trim() === `[${mediaLink.label}](${mediaLink.url})`;
      if (!mediaOnly) {
        elements.push(
          <Text key={`p-${i}`} style={ms.para}>
            <InlineLine text={line} />
          </Text>,
        );
      }
      elements.push(
        <MarkdownVideoPreview
          key={`vid-${i}`}
          url={mediaLink.url}
          label={mediaLink.label}
          youtube={mediaLink.youtube}
          showMediaPreviews={showMediaPreviews}
          previewScope={mediaPreviewScope}
          resetSignal={mediaPreviewResetSignal}
        />,
      );
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
  mediaFrame: { position: 'relative', marginVertical: 4 },
  mediaHideButton: { position: 'absolute', top: 8, right: 8, zIndex: 2, width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)' },
  mediaCollapsed: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#3f3f46', backgroundColor: 'rgba(39,39,42,0.35)', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, marginVertical: 4 },
  mediaCollapsedText: { flex: 1, color: C.muted, fontSize: 11 },
  youtubeCard: { position: 'relative', width: '100%', aspectRatio: 16 / 9, overflow: 'hidden', borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: '#27272a', backgroundColor: '#18181b' },
  youtubeImage: { width: '100%', height: '100%', opacity: 0.84 },
  videoLoader: { ...StyleSheet.absoluteFillObject, zIndex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  videoLoaderText: { color: C.muted, fontSize: 11 },
  videoFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoFallbackText: { color: C.muted, fontSize: 11 },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.12)' },
  playButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)' },
  youtubeLabel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  youtubeLabelText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  videoCard: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#27272a', backgroundColor: '#18181b', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9 },
  videoCardText: { flex: 1, color: C.muted, fontSize: 11 },
  videoLinkText: { color: C.blue, fontSize: 11, fontWeight: '600' },
});
