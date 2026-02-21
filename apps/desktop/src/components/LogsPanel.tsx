import { useState, useEffect, useRef } from 'react';
import type { LogEntry } from '../../electron/lib/log-buffer.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet.js';
import { Button } from '@/components/ui/button.js';

const ipc = window.ipc;

interface LogsPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const levelColors: Record<LogEntry['level'], string> = {
  log: 'text-muted-foreground',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

export function LogsPanel({ open, onClose }: LogsPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipc['logs:getHistory']().then(setLogs);
  }, []);

  useEffect(() => {
    const unsub = ipc.onLogEntry((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) next.shift();
        return next;
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleClear = () => {
    ipc['logs:clear']();
    setLogs([]);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="left" showCloseButton={false} className="w-[400px] flex flex-col gap-0 p-0">
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
          <SheetTitle className="text-sm">Logs</SheetTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" onClick={handleClear}>Clear</Button>
            <Button variant="ghost" size="xs" onClick={onClose}>Close</Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 && (
            <div className="text-muted-foreground text-center py-8 text-xs">No logs yet</div>
          )}
          {logs.map((entry, i) => (
            <div key={i} className={`flex gap-2 py-1 ${i > 0 ? 'border-t border-border/30' : ''}`}>
              <span className="text-muted-foreground/60 flex-shrink-0">{formatTime(entry.timestamp)}</span>
              <span className={`${levelColors[entry.level]} break-all min-w-0`}>{entry.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
