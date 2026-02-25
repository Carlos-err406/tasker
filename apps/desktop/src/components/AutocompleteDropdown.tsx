import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskStatus } from '@tasker/core/types';
import type { Suggestion } from '@/hooks/use-metadata-autocomplete.js';
import { cn } from '@/lib/utils.js';

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

export function AutocompleteDropdown({ suggestions, selectedIndex, onSelect, anchorRef }: AutocompleteDropdownProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  // Recompute position whenever anchor or suggestions change
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < 210;
    setStyle({
      position: 'fixed',
      width: `${rect.width}px`,
      left: `${rect.left}px`,
      ...(showAbove
        ? { bottom: `${window.innerHeight - rect.top + 4}px`, top: 'auto' }
        : { top: `${rect.bottom + 4}px`, bottom: 'auto' }),
      zIndex: 9999,
    });
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
          key={s.task.id}
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
          <span className="font-mono text-xs text-muted-foreground w-7 flex-shrink-0">{s.shortId}</span>
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', STATUS_DOT[s.task.status] ?? STATUS_DOT[0])} />
          <span className="truncate flex-1">{s.title}</span>
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{s.task.listName}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
