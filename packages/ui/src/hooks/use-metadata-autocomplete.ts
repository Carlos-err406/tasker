import { useState, useCallback, useRef, useEffect } from 'react';
import type { Task } from '@tasker/core/types';
import * as taskService from '../lib/services/tasks.js';
import * as listService from '../lib/services/lists.js';
import { listTargetKey } from '@tasker/core/parsers';
import { getDisplayTitle, getShortId } from '../lib/task-display.js';
import { getPlainText, setCaretOffset, getTextBeforeCursor } from '../lib/content-editable-utils.js';
import { parseDate } from '@tasker/core/parsers';
import { dateSuggestions, timeSuggestions } from '../lib/date-suggestions.js';

export type Suggestion =
  | { kind: 'task'; task: Task; shortId: string; title: string }
  | { kind: 'tag'; tag: string; count: number }
  | { kind: 'list'; name: string }
  | { kind: 'repeat'; token: string; label: string }
  | { kind: 'date'; date: string; label: string; detail: string }
  /** `leading`: inserted right after a just-picked date, so it brings its own space. */
  | { kind: 'time'; token: string; leading: boolean };

const REPEATS = [
  { token: 'daily', label: 'every day' },
  { token: 'weekly', label: 'every week' },
  { token: 'monthly', label: 'every month' },
  { token: 'yearly', label: 'every year' },
];

interface AutocompleteState {
  isOpen: boolean;
  suggestions: Suggestion[];
  selectedIndex: number;
  prefix: string;
  partial: string;
  /** Character index where the prefix starts in the textarea value */
  matchStart: number;
}

const CLOSED: AutocompleteState = {
  isOpen: false,
  suggestions: [],
  selectedIndex: 0,
  prefix: '',
  partial: '',
  matchStart: 0,
};

/** Regex to detect a metadata prefix at cursor position.
 *  Matches: ^, !, ~, -^, -! followed by optional partial ID/query chars,
 *  # followed by an optional partial tag (same characters as the parser),
 *  > followed by an optional partial list name, * followed by a partial repeat rule,
 *  or @ followed by a partial date. */
const PREFIX_RE = /(?:^|\s)(-[!^]|[!^~]|#|>|\*|@)([\w+-]*)$/;
/** A time being typed after a due date: `@fri 6`, `@2026-10-12 6:3`. */
const TIME_AFTER_DATE_RE = /(?:^|\s)@(\S+)\s(\d[\d:]*(?:[ap]m?)?)$/i;
/** The token a selection replaces, read from the live text at matchStart. */
const TOKEN_RE: Record<string, RegExp> = {
  '@': /^@[\w+-]*/,
  time: /^\d[\d:]*(?:[ap]m?)?/i,
};
const TAG_RE = /(?:^|\s)#([\w-]+)/g;

/** Existing tags ranked by prefix match, then usage, skipping ones already in the text. */
export function suggestTags(tasks: Task[], partial: string, text: string): Suggestion[] {
  const counts = new Map<string, number>();
  for (const task of tasks)
    for (const tag of task.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const present = new Set([...text.matchAll(TAG_RE)].map((m) => m[1]!.toLowerCase()));
  const lower = partial.toLowerCase();
  present.delete(lower);
  return [...counts]
    .filter(([tag]) => !present.has(tag.toLowerCase()) && tag.toLowerCase().includes(lower))
    .sort(
      ([a, countA], [b, countB]) =>
        Number(b.toLowerCase().startsWith(lower)) - Number(a.toLowerCase().startsWith(lower)) ||
        countB - countA ||
        a.localeCompare(b),
    )
    .slice(0, 50)
    .map(([tag, count]) => ({ kind: 'tag', tag, count }));
}

/** Lists whose `>` form contains what was typed, prefix matches first. */
export function suggestLists(lists: string[], partial: string): Suggestion[] {
  const typed = listTargetKey(partial);
  return lists
    .filter((name) => listTargetKey(name).includes(typed))
    .sort(
      (a, b) =>
        Number(listTargetKey(b).startsWith(typed)) - Number(listTargetKey(a).startsWith(typed)),
    )
    .map((name) => ({ kind: 'list', name }));
}

function suggestTasks(tasks: Task[], partial: string, excludeTaskId?: string): Suggestion[] {
  const lowerPartial = partial.toLowerCase();
  const filtered: Suggestion[] = [];
  for (const t of tasks) {
    if (excludeTaskId && t.id === excludeTaskId) continue;
    const sid = getShortId(t);
    const title = getDisplayTitle(t);
    if (!partial || sid.toLowerCase().startsWith(lowerPartial) || title.toLowerCase().includes(lowerPartial)) {
      filtered.push({ kind: 'task', task: t, shortId: sid, title });
    }
    if (filtered.length >= 50) break;
  }
  return filtered;
}

export function useMetadataAutocomplete(
  value: string,
  textareaRef: React.RefObject<HTMLDivElement | null>,
  excludeTaskId?: string,
) {
  const [state, setState] = useState<AutocompleteState>(CLOSED);
  const allTasksRef = useRef<Task[] | null>(null);
  /** Shared in-flight fetch — all concurrent detect() calls await the same Promise */
  const fetchPromiseRef = useRef<Promise<Task[] | null> | null>(null);
  /** Incremented on every detect() call; only the latest call updates state */
  const detectVersionRef = useRef(0);
  /** Suppresses the next detect() call after a selection (the inserted ID still matches the prefix regex) */
  const justSelectedRef = useRef(false);

  const fetchTasks = useCallback((): Promise<Task[] | null> => {
    if (allTasksRef.current) return Promise.resolve(allTasksRef.current);
    if (!fetchPromiseRef.current) {
      fetchPromiseRef.current = taskService.getAllTasks()
        .then((tasks) => { allTasksRef.current = tasks; return tasks; })
        .catch(() => null)
        .finally(() => { fetchPromiseRef.current = null; });
    }
    return fetchPromiseRef.current;
  }, []);

  /** Call this on every input event to detect a metadata prefix at the cursor.
   *  Reads text-before-cursor directly from the DOM (via Range cloning) so it
   *  is immune to React stale-closure issues and correctly handles multi-line
   *  contentEditable structures (<div>/<br> line breaks). */
  const detect = useCallback(
    async () => {
      if (justSelectedRef.current) {
        justSelectedRef.current = false;
        return;
      }
      const thisVersion = ++detectVersionRef.current;
      const el = textareaRef.current;
      if (!el) return;

      // Read text before cursor directly from the live DOM — this correctly
      // handles <div>/<br> line breaks that getCaretOffset+slice cannot.
      const textBeforeCursor = getTextBeforeCursor(el);

      // Check the current line only (from last newline to cursor)
      const lineStart = textBeforeCursor.lastIndexOf('\n') + 1;
      const lineText = textBeforeCursor.slice(lineStart);
      const timeMatch = TIME_AFTER_DATE_RE.exec(lineText);
      if (timeMatch && parseDate(timeMatch[1]!, new Date())) {
        const partial = timeMatch[2]!;
        const suggestions: Suggestion[] = timeSuggestions(partial).map((token) => ({ kind: 'time', token, leading: false }));
        setState({
          isOpen: suggestions.length > 0,
          suggestions,
          selectedIndex: 0,
          prefix: 'time',
          partial,
          matchStart: lineStart + timeMatch.index + timeMatch[0].length - partial.length,
        });
        return;
      }
      const match = PREFIX_RE.exec(lineText);

      if (!match) {
        // Leaving a prefix ends the lookup; the next one must see new tasks and
        // tags, even if this one never opened the dropdown.
        allTasksRef.current = null;
        if (state.isOpen) setState(CLOSED);
        return;
      }

      const prefix = match[1]!;
      const partial = match[2]!;
      // matchStart is the absolute index in value where the prefix begins
      const matchStart = lineStart + match.index + (match[0].startsWith(' ') ? 1 : 0);

      if (prefix === '@') {
        const suggestions: Suggestion[] = dateSuggestions(partial, new Date()).map((d) => ({ kind: 'date', ...d }));
        setState({ isOpen: suggestions.length > 0, suggestions, selectedIndex: 0, prefix, partial, matchStart });
        return;
      }

      if (prefix === '*') {
        const typed = partial.toLowerCase();
        const suggestions: Suggestion[] = REPEATS.filter((r) => r.token.startsWith(typed)).map((r) => ({ kind: 'repeat', ...r }));
        setState({ isOpen: suggestions.length > 0, suggestions, selectedIndex: 0, prefix, partial, matchStart });
        return;
      }

      if (prefix === '>') {
        const lists = await listService.getAllLists().catch(() => null);
        if (!lists || thisVersion !== detectVersionRef.current) return;
        const suggestions = suggestLists(lists, partial);
        setState({ isOpen: suggestions.length > 0, suggestions, selectedIndex: 0, prefix, partial, matchStart });
        return;
      }

      // Fetch tasks if needed
      let tasks = allTasksRef.current;
      if (!tasks) {
        tasks = await fetchTasks();
        if (!tasks) return;
      }

      // Discard stale result if a newer detect() has been called since we started
      if (thisVersion !== detectVersionRef.current) return;

      // Filter
      const filtered =
        prefix === '#'
          ? suggestTags(tasks, partial, getPlainText(el))
          : suggestTasks(tasks, partial, excludeTaskId);

      setState({
        isOpen: filtered.length > 0,
        suggestions: filtered,
        selectedIndex: 0,
        prefix,
        partial,
        matchStart,
      });
    },
    [textareaRef, excludeTaskId, state.isOpen, fetchTasks],
  );

  // Reset task cache when autocomplete closes so next open gets fresh data
  useEffect(() => {
    if (!state.isOpen) {
      allTasksRef.current = null;
      fetchPromiseRef.current = null;
    }
  }, [state.isOpen]);

  /** Insert the selected task ID into the value. Returns the new value string. */
  /** Apply a suggestion by list index, or a date picked from the calendar. */
  const select = useCallback(
    (choice: number | Suggestion): string | null => {
      if (!state.isOpen) return null;
      if (typeof choice === 'number' && (choice < 0 || choice >= state.suggestions.length)) return null;
      const suggestion = typeof choice === 'number' ? state.suggestions[choice]! : choice;

      // Read the live DOM text so we never operate on a stale React `value`.
      const el = textareaRef.current;
      const liveValue = el ? getPlainText(el) : value;

      // Scan forward from matchStart to find the TRUE end of prefix+partial
      // in the live text — don't trust state.partial which can be stale due
      // to React closure/batching races.
      const afterMatchStart = liveValue.slice(state.matchStart);
      const prefixPartialMatch = (TOKEN_RE[state.prefix] ?? /^(-[!^]|[!^~]|#|>|\*)[\w-]*/).exec(afterMatchStart);
      const replaceLen =
        suggestion.kind === 'time' && suggestion.leading
          ? 0
          : prefixPartialMatch
            ? prefixPartialMatch[0].length
            : state.prefix.length;

      // No trailing space: contenteditable collapses it before the next keystroke.
      const insertion =
        suggestion.kind === 'tag'
          ? `#${suggestion.tag}`
          : suggestion.kind === 'list'
            ? `>${listTargetKey(suggestion.name)}`
            : suggestion.kind === 'repeat'
              ? `*${suggestion.token}`
              : suggestion.kind === 'date'
                ? `@${suggestion.date}`
                : suggestion.kind === 'time'
                  ? `${suggestion.leading ? ' ' : ''}${suggestion.token}`
                  : state.prefix + suggestion.shortId;
      const newValue = liveValue.slice(0, state.matchStart) + insertion + liveValue.slice(state.matchStart + replaceLen);
      ++detectVersionRef.current; // Cancel in-flight detects so they can't re-open the dropdown
      justSelectedRef.current = true; // Suppress the next detect triggered by the new value
      // Set cursor position after insertion
      const cursorPos = state.matchStart + insertion.length;
      // A picked date offers a time next; Enter/Tab takes one, any other key moves on.
      setState(
        suggestion.kind === 'date'
          ? {
              isOpen: true,
              suggestions: timeSuggestions('').map((token) => ({ kind: 'time', token, leading: true })),
              selectedIndex: 0,
              prefix: 'time',
              partial: '',
              matchStart: cursorPos,
            }
          : CLOSED,
      );
      setTimeout(() => {
        if (textareaRef.current) {
          setCaretOffset(textareaRef.current, cursorPos);
        }
        // Inserting fires no input event, so stop suppressing once it lands;
        // otherwise the user's next keystroke (e.g. another #) is ignored.
        justSelectedRef.current = false;
      }, 0);
      return newValue;
    },
    [state, value, textareaRef],
  );

  /** Keyboard handler — returns true if the event was consumed by autocomplete */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!state.isOpen) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setState((s) => ({
          ...s,
          selectedIndex: Math.min(s.selectedIndex + 1, s.suggestions.length - 1),
        }));
        return true;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setState((s) => ({
          ...s,
          selectedIndex: Math.max(s.selectedIndex - 1, 0),
        }));
        return true;
      }

      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        return true; // caller should call select(state.selectedIndex)
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        ++detectVersionRef.current; // Cancel any in-flight detect so it can't re-open
        justSelectedRef.current = true; // Suppress the next detect triggered by React re-render
        setState(CLOSED);
        return true;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        return true; // caller should call select(state.selectedIndex)
      }

      return false;
    },
    [state.isOpen],
  );

  const dismiss = useCallback(() => setState(CLOSED), []);

  return {
    isOpen: state.isOpen,
    suggestions: state.suggestions,
    selectedIndex: state.selectedIndex,
    /** The date being typed after `@`, for the calendar; null outside a date. */
    calendarDate:
      state.isOpen && state.prefix === '@'
        ? (parseDate(state.partial, new Date()) ?? (state.suggestions[0]?.kind === 'date' ? state.suggestions[0].date : null))
        : null,
    detect,
    select,
    onKeyDown,
    dismiss,
  };
}
