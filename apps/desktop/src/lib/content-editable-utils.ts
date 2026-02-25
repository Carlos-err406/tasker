/**
 * Utilities for treating a contentEditable div like a textarea.
 * All functions skip ghost spans (data-ghost="true") when calculating
 * text content and cursor positions.
 */

function isGhostNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-ghost');
}

/**
 * Extract plain text from a contentEditable element, skipping ghost spans.
 * Handles both flat (raw text nodes) and wrapped (Chrome div-per-line) cases.
 */
export function getPlainText(el: HTMLElement): string {
  const lines: string[] = [];
  let current = '';

  function walk(node: Node) {
    if (isGhostNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent ?? '';
    } else if (node.nodeName === 'BR') {
      lines.push(current);
      current = '';
    } else if (node.nodeName === 'DIV') {
      if (lines.length > 0 || current.length > 0) {
        lines.push(current);
        current = '';
      }
      for (const child of node.childNodes) walk(child);
    } else {
      for (const child of node.childNodes) walk(child);
    }
  }

  for (const child of el.childNodes) walk(child);
  lines.push(current);

  return lines.join('\n');
}

/**
 * Compute the character offset (matching getPlainText's output) for a given
 * DOM container + offset pair. Uses Range-cloning so it correctly accounts
 * for \n from <div>/<br> line breaks.
 */
function domPositionToCharOffset(el: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(container, offset);
  const frag = range.cloneContents();
  const temp = document.createElement('div');
  temp.appendChild(frag);
  return getPlainText(temp).length;
}

/**
 * Get the caret character offset within the contentEditable element.
 * Correctly accounts for \n from <div>/<br> line breaks and skips ghost spans.
 */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  return domPositionToCharOffset(el, range.startContainer, range.startOffset);
}

/**
 * Get the plain text before the cursor by cloning the DOM range from the
 * start of the element to the caret position, then running getPlainText on
 * the clone. This correctly accounts for <div>/<br> line breaks that the
 * text-node-only getCaretOffset cannot.
 */
export function getTextBeforeCursor(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const caret = sel.getRangeAt(0);
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(caret.startContainer, caret.startOffset);
  const frag = range.cloneContents();
  const temp = document.createElement('div');
  temp.appendChild(frag);
  return getPlainText(temp);
}

/**
 * Find the DOM node + offset for a character offset that matches getPlainText's
 * output. Walks the DOM the same way getPlainText does, counting \n for
 * <div>/<br> boundaries and skipping ghost spans.
 * Returns [node, offset] or null if not found.
 */
function findDomPosition(el: HTMLElement, targetOffset: number): [Node, number] | null {
  let pos = 0;
  let hasContent = false;
  let lastTextNode: Node | null = null;
  let lastTextLen = 0;

  function walk(node: Node): [Node, number] | null {
    if (isGhostNode(node)) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (pos + len >= targetOffset) {
        return [node, targetOffset - pos];
      }
      pos += len;
      hasContent = true;
      lastTextNode = node;
      lastTextLen = len;
      return null;
    }

    if (node.nodeName === 'BR') {
      // BR pushes current line → adds \n
      pos += 1;
      hasContent = true;
      return null;
    }

    if (node.nodeName === 'DIV') {
      // DIV adds \n before its content if there was prior content
      if (hasContent) {
        if (targetOffset === pos) {
          // Target falls on the implicit \n — place at end of last text
          if (lastTextNode) return [lastTextNode, lastTextLen];
        }
        pos += 1;
      }
      for (const child of node.childNodes) {
        const result = walk(child);
        if (result) return result;
      }
      return null;
    }

    for (const child of node.childNodes) {
      const result = walk(child);
      if (result) return result;
    }
    return null;
  }

  for (const child of el.childNodes) {
    const result = walk(child);
    if (result) return result;
  }

  // Fallback: end of last text node
  if (lastTextNode) return [lastTextNode, lastTextLen];
  return null;
}

/**
 * Set the caret to a specific character offset, skipping ghost spans.
 * The offset matches getPlainText's character counting (including \n for line breaks).
 */
export function setCaretOffset(el: HTMLElement, targetOffset: number): void {
  const result = findDomPosition(el, targetOffset);
  if (result) {
    const range = document.createRange();
    range.setStart(result[0], result[1]);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }

  // Fallback: place caret at end of element
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * Insert a ghost span at the current cursor position.
 * The span has data-ghost="true" and contentEditable="false".
 */
export function insertGhostSpan(el: HTMLElement, text: string): void {
  removeGhostSpan(el);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.setAttribute('data-ghost', 'true');
  span.setAttribute('contenteditable', 'false');
  span.textContent = text;
  span.style.opacity = '0.4';
  span.style.pointerEvents = 'none';
  span.style.userSelect = 'none';
  range.insertNode(span);
  // Move caret to just before the ghost span (so it stays at user's position)
  range.setStartBefore(span);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Remove any ghost spans from the element.
 */
export function removeGhostSpan(el: HTMLElement): void {
  for (const span of Array.from(el.querySelectorAll('[data-ghost]'))) {
    span.remove();
  }
}

/**
 * Set plain text content, building the same DOM structure Chrome produces for
 * multi-line contentEditable (first line as a direct text node, subsequent
 * lines wrapped in <div> elements, empty lines represented by a <br>).
 */
export function setPlainText(el: HTMLElement, text: string): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!text.includes('\n')) {
    if (text) el.appendChild(document.createTextNode(text));
    return;
  }
  const lines = text.split('\n');
  if (lines[0]) el.appendChild(document.createTextNode(lines[0]!));
  for (let i = 1; i < lines.length; i++) {
    const div = document.createElement('div');
    const line = lines[i]!;
    div.appendChild(line ? document.createTextNode(line) : document.createElement('br'));
    el.appendChild(div);
  }
}

/**
 * Get both selection start and end character offsets, skipping ghost spans.
 * Uses Range-cloning so offsets correctly account for \n from <div>/<br> line breaks.
 */
export function getSelectionOffsets(el: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  const start = domPositionToCharOffset(el, range.startContainer, range.startOffset);
  const end = range.collapsed ? start : domPositionToCharOffset(el, range.endContainer, range.endOffset);
  return { start, end };
}

/**
 * Set both selection start and end character offsets, skipping ghost spans.
 * Offsets match getPlainText's character counting (including \n for line breaks).
 */
export function setSelectionOffsets(el: HTMLElement, start: number, end: number): void {
  if (start === end) {
    setCaretOffset(el, start);
    return;
  }

  const startResult = findDomPosition(el, start);
  const endResult = findDomPosition(el, end);
  if (!startResult || !endResult) {
    setCaretOffset(el, start);
    return;
  }

  const range = document.createRange();
  range.setStart(startResult[0], startResult[1]);
  range.setEnd(endResult[0], endResult[1]);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
