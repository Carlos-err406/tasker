import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskStatus } from '@tasker/core/types';
import type { Suggestion } from '../hooks/use-metadata-autocomplete.js';
import { cn } from '../lib/utils.js';
import { getHost } from '../host.js';
import { getTagColor } from '../lib/task-display.js';
import { Tag, List as ListIcon } from 'lucide-react';

interface AutocompleteDropdownProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const STATUS_DOT: Record<number, string> = {
  [TaskStatus.Pending]: 'bg-muted-foreground/40',
  [TaskStatus.InProgress]: 'bg-amber-400',
  [TaskStatus.Done]: 'bg-green-500',
};

/** The caret's line within the editor, clamped to the editor's visible box. */
function caretLine(el: HTMLElement, bounds: DOMRect): { top: number; bottom: number } | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const rect = [...range.getClientRects()].find((r) => r.height > 0) ?? range.getBoundingClientRect();
  if (!rect.height) return null;
  return {
    top: Math.min(Math.max(rect.top, bounds.top), bounds.bottom),
    bottom: Math.min(Math.max(rect.bottom, bounds.top), bounds.bottom),
  };
}

export function AutocompleteDropdown({ suggestions, selectedIndex, onSelect, anchorRef }: AutocompleteDropdownProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  // Recompute position whenever anchor or suggestions change, and while the
  // viewport moves (e.g. a soft keyboard opening) or the caret moves.
  useLayoutEffect(() => {
    const position = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // The touch editor fills the screen, so place the list at the caret line
      // instead of outside the editor.
      const line = (getHost().touch && caretLine(el, rect)) || rect;
      const viewport = window.visualViewport;
      const viewTop = viewport?.offsetTop ?? 0;
      const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
      const spaceBelow = viewBottom - line.bottom - 8;
      const spaceAbove = line.top - viewTop - 8;
      const showAbove = spaceBelow < 210 && spaceAbove > spaceBelow;
      setStyle({
        position: 'fixed',
        width: `${rect.width}px`,
        left: `${rect.left}px`,
        maxHeight: `${Math.max(0, Math.min(200, showAbove ? spaceAbove : spaceBelow))}px`,
        ...(showAbove
          ? { bottom: `${window.innerHeight - line.top + 4}px`, top: 'auto' }
          : { top: `${line.bottom + 4}px`, bottom: 'auto' }),
        zIndex: 9999,
      });
    };
    position();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    document.addEventListener('selectionchange', position);
    return () => {
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      document.removeEventListener('selectionchange', position);
    };
  }, [anchorRef, suggestions]);

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return createPortal(
    <div
      data-testid="metadata-autocomplete-dropdown"
      style={style}
      className="max-h-[200px] overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
      onMouseDown={(e) => e.preventDefault()} // prevent input blur
    >
      {suggestions.map((s, i) => (
        <button
          key={s.kind === 'tag' ? `#${s.tag}` : s.kind === 'list' ? `>${s.name}` : s.task.id}
          ref={i === selectedIndex ? selectedRef : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors',
            i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
          )}
        >
          {s.kind === 'list' ? (
            <>
              <ListIcon className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{s.name}</span>
            </>
          ) : s.kind === 'tag' ? (
            <>
              <span
                className={cn(
                  'inline-flex min-w-0 items-center gap-0.5 rounded-full px-1.5 font-mono text-xs',
                  getTagColor(s.tag),
                )}
              >
                <Tag className="h-2.5 w-2.5 flex-shrink-0" />
                <span className="truncate">{s.tag}</span>
              </span>
              <span className="flex-1" />
              <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                {s.count} {s.count === 1 ? 'task' : 'tasks'}
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-xs text-muted-foreground w-7 flex-shrink-0">{s.shortId}</span>
              <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', STATUS_DOT[s.task.status] ?? STATUS_DOT[0])} />
              <span className="truncate flex-1">{s.title}</span>
              <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{s.task.listName}</span>
            </>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
