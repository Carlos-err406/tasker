import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskStatus } from '@tasker/core/types';
import type { Suggestion } from '../hooks/use-metadata-autocomplete.js';
import { cn } from '../lib/utils.js';
import { getHost } from '../host.js';
import { getTagColor } from '../lib/task-display.js';
import { Tag, List as ListIcon, Repeat, Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate } from '@tasker/core/parsers';
import { calendarWeeks, describeDate, fromIso } from '../lib/date-suggestions.js';

interface AutocompleteDropdownProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  /** A list index, or a date picked from the calendar. */
  onSelect: (choice: number | Suggestion) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Shows a month calendar under date suggestions, opened at this date. */
  calendarDate?: string | null;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

/** A month grid for picking any due date; days are buttons that keep the editor focused. */
function MonthCalendar({ date, onPick }: { date: string; onPick: (date: string) => void }) {
  const [shown, setShown] = useState(() => fromIso(date));
  useEffect(() => setShown(fromIso(date)), [date]);
  const today = formatDate(new Date());
  const year = shown.getFullYear();
  const month = shown.getMonth();
  const step = (delta: number) => setShown(new Date(year, month + delta, 1));
  const nav = 'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground';
  return (
    <div data-testid="date-picker-calendar" className="shrink-0 border-t border-border px-2 pb-2 pt-1 text-xs">
      <div className="flex items-center justify-between py-1">
        <button type="button" aria-label="Previous month" className={nav} onMouseDown={(e) => { e.preventDefault(); step(-1); }}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="font-medium" aria-live="polite">{MONTH.format(shown)}</span>
        <button type="button" aria-label="Next month" className={nav} onMouseDown={(e) => { e.preventDefault(); step(1); }}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d}>{d}</span>)}
      </div>
      {calendarWeeks(year, month).map((week, w) => (
        <div key={w} className="grid grid-cols-7">
          {week.map((day, d) =>
            day ? (
              <button
                key={day}
                type="button"
                aria-label={`Pick ${describeDate(day, new Date(0))}`}
                aria-current={day === today ? 'date' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(day);
                }}
                className={cn(
                  'm-px rounded py-1 text-center hover:bg-accent',
                  day < today && 'text-muted-foreground/50',
                  day === today && 'font-semibold text-orange-400',
                  day === date && 'bg-accent text-accent-foreground',
                )}
              >
                {Number(day.slice(8))}
              </button>
            ) : (
              <span key={`empty-${d}`} />
            ),
          )}
        </div>
      ))}
    </div>
  );
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

export function AutocompleteDropdown({ suggestions, selectedIndex, onSelect, anchorRef, calendarDate }: AutocompleteDropdownProps) {
  const maxHeight = calendarDate ? 380 : 200;
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
      const showAbove = spaceBelow < maxHeight + 10 && spaceAbove > spaceBelow;
      setStyle({
        position: 'fixed',
        width: `${rect.width}px`,
        left: `${rect.left}px`,
        maxHeight: `${Math.max(0, Math.min(maxHeight, showAbove ? spaceAbove : spaceBelow))}px`,
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
  }, [anchorRef, suggestions, maxHeight]);

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return createPortal(
    <div
      data-testid="metadata-autocomplete-dropdown"
      style={style}
      className="flex flex-col overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
      onMouseDown={(e) => e.preventDefault()} // prevent input blur
    >
      {/* With the calendar, the picks scroll and the calendar stays whole; on a
          phone they sit two to a row so both fit above the keyboard. */}
      <div className={cn(calendarDate && 'min-h-8 overflow-y-auto', calendarDate && getHost().touch && suggestions.length > 1 && 'grid grid-cols-2')}>
        {suggestions.map((s, i) => (
          <button
            key={
              s.kind === 'tag'
                ? `#${s.tag}`
                : s.kind === 'list'
                  ? `>${s.name}`
                  : s.kind === 'repeat'
                    ? `*${s.token}`
                    : s.kind === 'date'
                      ? `@${s.date}`
                      : s.kind === 'time'
                        ? `time:${s.token}`
                        : s.task.id
            }
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
            {s.kind === 'date' ? (
              <>
                <Calendar className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">{s.label}</span>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{s.detail}</span>
              </>
            ) : s.kind === 'time' ? (
              <>
                <Clock className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                <span className="flex-1 font-mono text-xs">{s.token}</span>
              </>
            ) : s.kind === 'repeat' ? (
              <>
                <Repeat className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs flex-1">*{s.token}</span>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{s.label}</span>
              </>
            ) : s.kind === 'list' ? (
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
      </div>
      {calendarDate && (
        <MonthCalendar
          date={calendarDate}
          onPick={(date) => onSelect({ kind: 'date', date, label: '', detail: '' })}
        />
      )}
    </div>,
    document.body,
  );
}
