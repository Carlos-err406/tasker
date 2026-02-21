import { useState, useEffect, useRef, useCallback } from 'react';
import type { Task } from '@tasker/core/types';
import { parseTaskDescription, syncMetadataToDescription } from '@tasker/core/parsers';
import { addTask } from '@/lib/services/tasks.js';
import { cn } from '@/lib/utils.js';
import { MarkdownContent } from '@/components/MarkdownContent.js';
import { Button } from '@/components/ui/button.js';
import { Textarea } from '@/components/ui/textarea.js';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.js';

interface DecomposePanelProps {
  task: Task | null;
  onClose: () => void;
  onCreated: () => void;
}


/** Strip markdown code fences (e.g. ```xml ... ```) from text. */
function stripCodeFences(text: string): string {
  return text.replace(/^```[a-zA-Z]*\n?/gm, '').replace(/^```$/gm, '');
}

/** Return true if text contains only metadata tokens (p1/p2/p3, @date, #tag, ^id, !id). */
function isMetadataOnly(text: string): boolean {
  return (
    text.trim().length > 0 &&
    text
      .trim()
      .split(/\s+/)
      .every((t) => /^(p[123]|@\S+|#\S+|\^[a-z0-9]+|![a-z0-9]+|-\^[a-z0-9]+|-![a-z0-9]+|~[a-z0-9]+)$/i.test(t))
  );
}

/** Extract complete <task>...</task> text bodies from accumulated XML stream.
 *  Metadata-only elements (e.g. "p1 #palette") are merged into the preceding task
 *  rather than becoming separate rows. */
function extractTasks(text: string): string[] {
  const matches = [...stripCodeFences(text).matchAll(/<task>([\s\S]*?)<\/task>/g)];
  const raw = matches.map((m) => m[1].trim()).filter(Boolean);
  return raw.reduce<string[]>((acc, item) => {
    if (isMetadataOnly(item) && acc.length > 0) {
      acc[acc.length - 1] = acc[acc.length - 1] + '\n' + item;
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

/** Return prose before the <tasks> block (the LLM's reasoning). */
function getProse(text: string): string {
  const clean = stripCodeFences(text);
  const idx = clean.indexOf('<tasks>');
  return idx === -1 ? clean.trim() : clean.slice(0, idx).trim();
}

export function DecomposePanel({ task, onClose, onCreated }: DecomposePanelProps) {
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const seenCount = useRef(0);
  const open = task !== null;

  // Reset and kick off stream whenever the panel opens with a new task
  useEffect(() => {
    if (!task) return;

    setStreamText('');
    setError(null);
    setSubtasks([]);
    setStreaming(true);
    seenCount.current = 0;

    console.log('[DecomposePanel] registering listeners for task', task.id);

    const unsubChunk = window.ipc.onDecomposeChunk((chunk) => {
      setStreamText((prev) => {
        const next = prev + chunk;
        const all = extractTasks(next);
        if (all.length > seenCount.current) {
          const newOnes = all.slice(seenCount.current);
          seenCount.current = all.length;
          setSubtasks((prev) => [...prev, ...newOnes]);
        }
        return next;
      });
    });

    const unsubDone = window.ipc.onDecomposeDone(() => {
      console.log('[DecomposePanel] done received');
      setStreaming(false);
    });

    const unsubError = window.ipc.onDecomposeError((message) => {
      console.log('[DecomposePanel] error received:', message);
      setError(message);
      setStreaming(false);
    });

    console.log('[DecomposePanel] calling decompose:start');
    window.ipc['decompose:start'](task.id);

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [task?.id]);

  const handleUpdateSubtask = useCallback((index: number, value: string) => {
    setSubtasks((prev) => prev.map((s, i) => (i === index ? value : s)));
  }, []);

  const handleDeleteSubtask = useCallback((index: number) => {
    setSubtasks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddRow = useCallback(() => {
    setSubtasks((prev) => [...prev, '']);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!task) return;
    const toCreate = subtasks.filter((s) => s.trim());
    if (!toCreate.length) return;
    setConfirming(true);
    try {
      for (const desc of toCreate) {
        const parsed = parseTaskDescription(desc);
        const withParent = syncMetadataToDescription(
          desc,
          parsed.priority,
          parsed.dueDate,
          parsed.tags,
          task.id,
        );
        await addTask(withParent, task.listName);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    }
  }, [subtasks, task, onCreated]);

  const abortAndClose = useCallback(() => {
    if (streaming) window.ipc['decompose:abort']();
    onClose();
  }, [streaming, onClose]);

  const prose = task ? getProse(streamText) : '';
  const taskTitle = task?.description.split('\n')[0] ?? '';
  const confirmCount = subtasks.filter((s) => s.trim()).length;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) abortAndClose(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-full h-full flex flex-col gap-0 p-0"
      >
        {/* Header */}
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 min-w-0 text-sm">
            <span className="truncate">Decompose: {taskTitle}</span>
          </SheetTitle>
          <Button variant="ghost" size="xs" onClick={abortAndClose}>
            Cancel
          </Button>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-3 min-h-0">
          {/* Prose / reasoning */}
          {prose && (
            <div className="border-l-2 border-border pl-3">
              <MarkdownContent content={prose} />
            </div>
          )}

          {/* Thinking indicator */}
          {streaming && subtasks.length === 0 && !error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Thinking…</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Subtask rows */}
          {subtasks.length > 0 && (
            <div className="space-y-1.5">
              {streaming && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Generating subtasks…</span>
                </div>
              )}
              {subtasks.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                  <Textarea
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                      }
                    }}
                    value={s}
                    rows={1}
                    onChange={(e) => {
                      handleUpdateSubtask(i, e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                    }}
                    className="min-h-0 field-sizing-fixed flex-1 bg-secondary/30 border-border/50 px-2 py-1 text-xs resize-none overflow-hidden"
                    placeholder="Subtask description…"
                  />
                  <button
                    onClick={() => handleDeleteSubtask(i)}
                    className="text-muted-foreground hover:text-red-400 flex-shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add row (only after stream done) */}
          {!streaming && !error && (
            <button
              onClick={handleAddRow}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add subtask
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-border/50 flex-shrink-0">
          <Button
            size="xs"
            onClick={handleConfirm}
            disabled={confirming || confirmCount === 0}
          >
            {confirming
              ? 'Creating…'
              : confirmCount === 0
                ? 'No subtasks'
                : `Create ${confirmCount} subtask${confirmCount !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
