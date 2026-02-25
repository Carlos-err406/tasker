import { useState, useCallback, useRef, useEffect } from 'react';
import type { Task } from '@tasker/core/types';
import * as taskService from '@/lib/services/tasks.js';
import { getDisplayTitle, getShortId } from '@/lib/task-display.js';
import { getPlainText, setCaretOffset, getTextBeforeCursor } from '@/lib/content-editable-utils.js';

export interface Suggestion {
  task: Task;
  shortId: string;
  title: string;
}

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

/** Regex to detect a metadata relationship prefix at cursor position.
 *  Matches: ^, !, ~, -^, -!  followed by optional partial ID/query chars */
const PREFIX_RE = /(?:^|\s)(-[!^]|[!^~])(\w*)$/;

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
      const match = PREFIX_RE.exec(lineText);

      if (!match) {
        if (state.isOpen) setState(CLOSED);
        return;
      }

      const prefix = match[1]!;
      const partial = match[2]!;
      // matchStart is the absolute index in value where the prefix begins
      const matchStart = lineStart + match.index + (match[0].startsWith(' ') ? 1 : 0);

      // Fetch tasks if needed
      let tasks = allTasksRef.current;
      if (!tasks) {
        tasks = await fetchTasks();
        if (!tasks) return;
      }

      // Discard stale result if a newer detect() has been called since we started
      if (thisVersion !== detectVersionRef.current) return;

      // Filter
      const lowerPartial = partial.toLowerCase();
      const filtered: Suggestion[] = [];
      for (const t of tasks) {
        if (excludeTaskId && t.id === excludeTaskId) continue;
        const sid = getShortId(t);
        const title = getDisplayTitle(t);
        if (!partial || sid.toLowerCase().startsWith(lowerPartial) || title.toLowerCase().includes(lowerPartial)) {
          filtered.push({ task: t, shortId: sid, title });
        }
        if (filtered.length >= 50) break;
      }

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
  const select = useCallback(
    (index: number): string | null => {
      if (!state.isOpen || index < 0 || index >= state.suggestions.length) return null;
      const suggestion = state.suggestions[index]!;

      // Read the live DOM text so we never operate on a stale React `value`.
      const el = textareaRef.current;
      const liveValue = el ? getPlainText(el) : value;

      // Scan forward from matchStart to find the TRUE end of prefix+partial
      // in the live text — don't trust state.partial which can be stale due
      // to React closure/batching races.
      const afterMatchStart = liveValue.slice(state.matchStart);
      const prefixPartialMatch = /^(-[!^]|[!^~])\w*/.exec(afterMatchStart);
      const replaceLen = prefixPartialMatch ? prefixPartialMatch[0].length : state.prefix.length;

      const insertion = state.prefix + suggestion.shortId;
      const newValue = liveValue.slice(0, state.matchStart) + insertion + liveValue.slice(state.matchStart + replaceLen);
      ++detectVersionRef.current; // Cancel in-flight detects so they can't re-open the dropdown
      justSelectedRef.current = true; // Suppress the next detect triggered by the new value
      setState(CLOSED);
      // Set cursor position after insertion
      const cursorPos = state.matchStart + insertion.length;
      setTimeout(() => {
        if (textareaRef.current) {
          setCaretOffset(textareaRef.current, cursorPos);
        }
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
    detect,
    select,
    onKeyDown,
    dismiss,
  };
}
