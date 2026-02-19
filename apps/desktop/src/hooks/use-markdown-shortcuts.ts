import { useRef, useCallback } from 'react';

/**
 * Markdown keyboard shortcuts for a textarea. All wrap shortcuts toggle
 * (unwrap if the selection or cursor is already inside the wrapper).
 *
 * - Cmd+B: bold (**)
 * - Cmd+I: italic (*)
 * - Cmd+U: underline (<u></u>)
 * - Cmd+Shift+X: strikethrough (~)
 * - Cmd+Shift+I: image template ![alt](url)
 * - Cmd+K: link template [text](url)
 * - Tab: jump to next placeholder in template, or insert 2 spaces
 *
 * Image and link templates support a single Tab-stop: after insertion the
 * cursor is placed at the first placeholder. Pressing Tab selects the
 * content inside the following parentheses.
 */
export function useMarkdownShortcuts(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  setValue: (v: string) => void,
) {
  // Whether we're in a template tab-stop mode (user just inserted a link/image template
  // and is editing the first placeholder). Tab should jump to the () group.
  const hasTabStop = useRef(false);

  /** Replace text in the textarea, update React state, and set selection. */
  const applyEdit = useCallback(
    (
      el: HTMLTextAreaElement,
      newValue: string,
      selStart: number,
      selEnd: number,
    ) => {
      setValue(newValue);
      requestAnimationFrame(() => {
        el.setSelectionRange(selStart, selEnd);
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      });
    },
    [setValue],
  );

  /** Wrap/unwrap the current selection with markdown wrappers (toggle behavior).
   *  If endWrapper is omitted, the same wrapper is used for both sides. */
  const wrapSelection = useCallback(
    (el: HTMLTextAreaElement, wrapper: string, endWrapper?: string) => {
      const end_w = endWrapper ?? wrapper;
      const { selectionStart: start, selectionEnd: end, value } = el;
      const selected = value.slice(start, end);
      const wLen = wrapper.length;
      const ewLen = end_w.length;

      if (selected.length > 0) {
        // Check if selection is already wrapped — unwrap if so
        const before = value.slice(Math.max(0, start - wLen), start);
        const after = value.slice(end, end + ewLen);
        if (before === wrapper && after === end_w) {
          const newValue = value.slice(0, start - wLen) + selected + value.slice(end + ewLen);
          applyEdit(el, newValue, start - wLen, end - wLen);
          return;
        }
        // Also handle if the wrappers are inside the selection
        if (selected.startsWith(wrapper) && selected.endsWith(end_w) && selected.length > wLen + ewLen) {
          const unwrapped = selected.slice(wLen, -ewLen);
          const newValue = value.slice(0, start) + unwrapped + value.slice(end);
          applyEdit(el, newValue, start, start + unwrapped.length);
          return;
        }
        // Wrap existing selection
        const wrapped = `${wrapper}${selected}${end_w}`;
        const newValue = value.slice(0, start) + wrapped + value.slice(end);
        applyEdit(el, newValue, start + wLen, end + wLen);
      } else {
        // No selection: check if cursor is inside an existing wrapper pair — unwrap if so
        const textBefore = value.slice(Math.max(0, start - wLen), start);
        const textAfter = value.slice(start, start + ewLen);
        if (textBefore === wrapper && textAfter === end_w) {
          const newValue = value.slice(0, start - wLen) + value.slice(start + ewLen);
          applyEdit(el, newValue, start - wLen, start - wLen);
          return;
        }
        // Insert wrapper pair and place cursor inside
        const inserted = `${wrapper}${end_w}`;
        const newValue = value.slice(0, start) + inserted + value.slice(end);
        const cursorPos = start + wLen;
        applyEdit(el, newValue, cursorPos, cursorPos);
      }
    },
    [applyEdit],
  );

  /** Insert a template with two tab-stop placeholders. */
  const insertTemplate = useCallback(
    (el: HTMLTextAreaElement, prefix: string) => {
      const { selectionStart: start, value } = el;
      const placeholder1 = prefix === '!' ? 'alt' : 'text';
      const placeholder2 = 'url';
      const template = `${prefix}[${placeholder1}](${placeholder2})`;
      const newValue = value.slice(0, start) + template + value.slice(start);

      // Position of $1 placeholder (the text inside [])
      const p1Start = start + prefix.length + 1; // after prefix + [
      const p1End = p1Start + placeholder1.length;

      // Enable tab-stop mode — Tab will find and select content in ()
      hasTabStop.current = true;
      applyEdit(el, newValue, p1Start, p1End);
    },
    [applyEdit],
  );

  /** Handle Tab key to advance to the next tab-stop. Returns true if handled. */
  const handleTab = useCallback(
    (el: HTMLTextAreaElement): boolean => {
      if (!hasTabStop.current) return false;
      hasTabStop.current = false;

      // Find the `](` after the cursor, then select content between ( and )
      const { value, selectionEnd } = el;
      const closeBracket = value.indexOf('](', selectionEnd);
      if (closeBracket < 0) return false;

      const parenStart = closeBracket + 2; // position after `(`
      const parenEnd = value.indexOf(')', parenStart);
      if (parenEnd < 0) return false;

      requestAnimationFrame(() => {
        el.setSelectionRange(parenStart, parenEnd);
      });
      return true;
    },
    [],
  );

  /**
   * onKeyDown handler for the textarea. Call this from the textarea's onKeyDown.
   * Returns true if the event was handled (caller should not process further).
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const el = textareaRef.current;
      if (!el) return false;

      // Tab key: navigate to tab-stop, or insert indent
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        // Tab-stop navigation (from image/link template)
        if (handleTab(el)) {
          e.preventDefault();
          return true;
        }
        // Insert tab for indentation
        e.preventDefault();
        const { selectionStart: s, selectionEnd: end, value } = el;
        const indent = '\t';
        const newValue = value.slice(0, s) + indent + value.slice(end);
        const pos = s + indent.length;
        applyEdit(el, newValue, pos, pos);
        return true;
      }

      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return false;

      // Cmd+B: bold
      if (e.key === 'b' && !e.shiftKey) {
        e.preventDefault();
        wrapSelection(el, '**');
        return true;
      }

      // Cmd+I (no shift): italic
      if (e.key === 'i' && !e.shiftKey) {
        e.preventDefault();
        wrapSelection(el, '*');
        return true;
      }

      // Cmd+Shift+I: image template
      if (e.key === 'i' && e.shiftKey) {
        e.preventDefault();
        insertTemplate(el, '!');
        return true;
      }

      // Cmd+U: underline (HTML <u> tag wrapper)
      if (e.key === 'u' && !e.shiftKey) {
        e.preventDefault();
        wrapSelection(el, '<u>', '</u>');
        return true;
      }

      // Cmd+Shift+X: strikethrough
      if (e.key === 'x' && e.shiftKey) {
        e.preventDefault();
        wrapSelection(el, '~');
        return true;
      }

      // Cmd+K: link template
      if (e.key === 'k' && !e.shiftKey) {
        e.preventDefault();
        insertTemplate(el, '');
        return true;
      }

      return false;
    },
    [textareaRef, applyEdit, wrapSelection, insertTemplate, handleTab],
  );

  return { onKeyDown };
}
