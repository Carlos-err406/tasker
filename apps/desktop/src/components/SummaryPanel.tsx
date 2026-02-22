import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent.js';
import { Button } from '@/components/ui/button.js';
import { Loader2, Check, Copy } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.js';

interface SummaryPanelProps {
  params: { listName: string; timeRange: string } | null;
  onClose: () => void;
}

const TIME_RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  all:   'All time',
};

export function SummaryPanel({ params, onClose }: SummaryPanelProps) {
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = params !== null;

  // Reset and kick off stream whenever the panel opens with new params
  useEffect(() => {
    if (!params) return;

    setStreamText('');
    setError(null);
    setStreaming(true);

    console.log('[SummaryPanel] registering listeners for list', params.listName);

    const unsubChunk = window.ipc.onSummaryChunk((chunk) => {
      setStreamText((prev) => prev + chunk);
    });

    const unsubDone = window.ipc.onSummaryDone(() => {
      console.log('[SummaryPanel] done received');
      setStreaming(false);
    });

    const unsubError = window.ipc.onSummaryError((message) => {
      console.log('[SummaryPanel] error received:', message);
      setError(message);
      setStreaming(false);
    });

    console.log('[SummaryPanel] calling summary:start');
    window.ipc['summary:start'](params.listName, params.timeRange);

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [params?.listName, params?.timeRange]);

  const abortAndClose = useCallback(() => {
    if (streaming) window.ipc['summary:abort']();
    onClose();
  }, [streaming, onClose]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(streamText).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [streamText]);

  const timeRangeLabel = params ? (TIME_RANGE_LABELS[params.timeRange] ?? params.timeRange) : '';

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) abortAndClose(); }}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[400px] h-full flex flex-col gap-0 p-0"
      >
        {/* Header */}
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 min-w-0 text-sm">
            <span className="truncate">
              {params?.listName ?? ''} · {timeRangeLabel}
            </span>
          </SheetTitle>
          <Button variant="ghost" size="xs" onClick={abortAndClose}>
            Cancel
          </Button>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-3 min-h-0">
          {/* Thinking indicator */}
          {streaming && !streamText && !error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Generating…</span>
            </div>
          )}

          {/* Streamed markdown content */}
          {streamText && (
            <MarkdownContent content={streamText} />
          )}

          {/* Streaming indicator (while content is appearing) */}
          {streaming && streamText && !error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Generating…</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-border/50 flex-shrink-0">
          <Button
            size="xs"
            variant="outline"
            onClick={handleCopy}
            disabled={streaming || !streamText}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
