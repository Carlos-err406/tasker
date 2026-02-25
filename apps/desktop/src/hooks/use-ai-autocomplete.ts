import { useState, useCallback, useRef } from 'react';
import { getPlainText, getCaretOffset, insertGhostSpan, removeGhostSpan, setCaretOffset, setPlainText } from '@/lib/content-editable-utils.js';

const AI_COMPLETE = 'ai:complete';
const AI_COMPLETE_ABORT = 'ai:complete:abort';

interface GhostInfo {
  /** Plain text before the ghost insertion point */
  textBefore: string;
  /** Plain text after the ghost insertion point */
  textAfter: string;
  /** The full original ghost text (never mutated) */
  fullGhost: string;
}

export function useAiAutocomplete(
  addInputRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  listName: string,
  onError?: (message: string) => void,
) {
  const [ghostText, setGhostText] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedRef = useRef(false);
  const ghostInfoRef = useRef<GhostInfo | null>(null);
  /** Ref mirror of ghostText to avoid stale closures in onValueChange */
  const ghostTextRef = useRef('');

  const clearGhost = useCallback(() => {
    setGhostText('');
    ghostTextRef.current = '';
    ghostInfoRef.current = null;
    if (addInputRef.current) removeGhostSpan(addInputRef.current);
  }, [addInputRef]);

  const cancelPending = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    abortedRef.current = true;
    window.ipc[AI_COMPLETE_ABORT]?.();
    clearGhost();
  }, [clearGhost]);

  const onValueChange = useCallback(
    (value: string) => {
      // Check if user is typing through the ghost (progressive consumption).
      // Use refs exclusively — state can be stale between rapid keystrokes.
      const info = ghostInfoRef.current;
      if (info) {
        const { textBefore, textAfter, fullGhost } = info;

        // Verify the text before and after the ghost position are unchanged
        const afterLen = textAfter.length;
        const expectedSuffix = afterLen > 0 ? value.slice(-afterLen) : '';
        const valueBeforeSuffix = afterLen > 0 ? value.slice(0, -afterLen) : value;

        if (
          valueBeforeSuffix.startsWith(textBefore) &&
          (afterLen === 0 || expectedSuffix === textAfter)
        ) {
          // Normalize non-breaking spaces (U+00A0) that Chrome inserts in
          // contentEditable to regular spaces for comparison with ghost text
          const typed = valueBeforeSuffix.slice(textBefore.length).replace(/\u00A0/g, ' ');
          if (typed.length > 0 && fullGhost.startsWith(typed)) {
            const remaining = fullGhost.slice(typed.length);
            if (remaining) {
              setGhostText(remaining);
              ghostTextRef.current = remaining;
              if (addInputRef.current) {
                removeGhostSpan(addInputRef.current);
                insertGhostSpan(addInputRef.current, remaining);
              }
            } else {
              // Fully consumed the ghost — suppress any retrigger
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = null;
              abortedRef.current = true;
              clearGhost();
            }
            return;
          }
        }

        // Value doesn't match ghost pattern — ghost is stale, clear it
      }

      // Not a ghost consumption — clear and maybe retrigger
      clearGhost();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      abortedRef.current = true;
      window.ipc[AI_COMPLETE_ABORT]?.();

      if (!enabled || value.trim().length < 3) return;

      // Suppress when cursor is on a metadata-prefix line (covers ^, !, ~, -^, -!)
      const firstLine = value.split('\n')[0] ?? '';
      if (/(?:^|\s)(-[!^]|[!^~])\w*$/.test(firstLine)) return;

      abortedRef.current = false;
      const caretOffset = addInputRef.current ? getCaretOffset(addInputRef.current) : value.length;
      debounceRef.current = setTimeout(async () => {
        try {
          const result = await window.ipc[AI_COMPLETE]({ text: value, caretOffset, listName });
          if (abortedRef.current || !result) return;

          // Strip if the model repeated the input prefix
          const ghost = result.toLowerCase().startsWith(firstLine.toLowerCase())
            ? result.slice(firstLine.length)
            : result;

          if (ghost && addInputRef.current) {
            // Capture context before inserting ghost
            const el = addInputRef.current;
            const currentText = getPlainText(el);
            const cursorPos = getCaretOffset(el);

            ghostInfoRef.current = {
              textBefore: currentText.slice(0, cursorPos),
              textAfter: currentText.slice(cursorPos),
              fullGhost: ghost,
            };

            setGhostText(ghost);
            ghostTextRef.current = ghost;
            insertGhostSpan(el, ghost);
          }
        } catch (err) {
          if (!abortedRef.current) {
            console.warn('[ai-complete] completion failed:', err);
            onError?.('AI completion unavailable');
          }
        }
      }, 400);
    },
    [enabled, clearGhost, addInputRef, listName, onError],
  );

  const acceptGhost = useCallback((): string => {
    const el = addInputRef.current;
    const ghost = ghostTextRef.current;
    if (!el || !ghost) return el ? getPlainText(el) : '';

    // Cursor is right before the ghost span — get position before removing
    const cursorPos = getCaretOffset(el);

    removeGhostSpan(el);
    const current = getPlainText(el);

    // Insert ghost text at the cursor position (where the ghost was), not at end
    const newValue = current.slice(0, cursorPos) + ghost + current.slice(cursorPos);
    setPlainText(el, newValue);
    setCaretOffset(el, cursorPos + ghost.length);
    setGhostText('');
    ghostTextRef.current = '';
    ghostInfoRef.current = null;
    return newValue;
  }, [addInputRef]);

  return { ghostText, acceptGhost, dismissGhost: clearGhost, onValueChange, cancelPending };
}
