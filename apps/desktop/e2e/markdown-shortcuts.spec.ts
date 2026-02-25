import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

/**
 * Open the edit input for a task item via context menu.
 * Waits for the 50ms startEdit timeout to fill and focus the div.
 */
async function openEdit(page: import('@playwright/test').Page, itemLocator: import('@playwright/test').Locator) {
  await itemLocator.click({ button: 'right' });
  await page.waitForSelector('[role="menu"]');
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editInput = page.locator('[data-testid="task-edit-input"]');
  await expect(editInput).toBeVisible();
  await expect(editInput).not.toBeEmpty();
  return editInput;
}

/**
 * Get the plain text and selection range from the edit input.
 * Uses evaluate to read from the live DOM.
 */
async function getInputState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="task-edit-input"]') as HTMLElement | null;
    if (!el) return { text: '', selStart: 0, selEnd: 0 };
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { text: el.innerText, selStart: 0, selEnd: 0 };

    // Walk text nodes to compute character offsets that match getPlainText's output
    function charOffset(container: Node, offset: number): number {
      const range = document.createRange();
      range.selectNodeContents(el!);
      range.setEnd(container, offset);
      const frag = range.cloneContents();
      const temp = document.createElement('div');
      temp.appendChild(frag);
      // Simplified getPlainText (matches the real one)
      const lines: string[] = [];
      let current = '';
      function walk(node: Node) {
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
      for (const child of temp.childNodes) walk(child);
      lines.push(current);
      return lines.join('\n').length;
    }

    const range = sel.getRangeAt(0);
    const selStart = charOffset(range.startContainer, range.startOffset);
    const selEnd = charOffset(range.endContainer, range.endOffset);

    // getPlainText equivalent
    const lines: string[] = [];
    let cur = '';
    function walkEl(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        cur += node.textContent ?? '';
      } else if (node.nodeName === 'BR') {
        lines.push(cur);
        cur = '';
      } else if (node.nodeName === 'DIV') {
        if (lines.length > 0 || cur.length > 0) {
          lines.push(cur);
          cur = '';
        }
        for (const child of node.childNodes) walkEl(child);
      } else {
        for (const child of node.childNodes) walkEl(child);
      }
    }
    for (const child of el.childNodes) walkEl(child);
    lines.push(cur);
    const text = lines.join('\n');

    return { text, selStart, selEnd };
  });
}

test.describe('Markdown shortcuts — link template (Cmd+K)', () => {
  test('inserts [text](url) and selects "text" placeholder', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    // Move cursor to end and insert link template
    await editInput.press('End');
    await editInput.press('Meta+k');
    await page.waitForTimeout(50); // rAF for selection

    const state = await getInputState(page);
    expect(state.text).toBe('My task[text](url)');
    // "text" should be selected
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('text');
  });

  test('Tab jumps from [text] to select "url" placeholder', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    // Tab should jump to the url placeholder
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('My task[text](url)');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('url');
  });

  test('typing replaces selected "text", then Tab selects "url"', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    // Type to replace selected "text" placeholder
    await page.keyboard.type('click here');

    // Tab to url
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('My task[click here](url)');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('url');
  });

  test('typing replaces "url" after Tab', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    await page.keyboard.type('docs');
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    // Type to replace selected "url" placeholder
    await page.keyboard.type('https://example.com');

    const state = await getInputState(page);
    expect(state.text).toBe('My task[docs](https://example.com)');
  });

  test('second Tab after url inserts indent (no more tab-stops)', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    // Tab to url
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    // Second Tab — tab-stop consumed, should insert indent
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    // The "url" was still selected when second Tab hit, so it gets replaced by a tab char
    expect(state.text).toContain('\t');
  });

  test('full flow: type text, tab, type url, submit saves correctly', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    // Fill both placeholders
    await page.keyboard.type('docs');
    await editInput.press('Tab');
    await page.waitForTimeout(50);
    await page.keyboard.type('https://example.com');

    // Submit and verify the task name includes the link markdown
    await editInput.press('Meta+Enter');
    await expect(editInput).not.toBeVisible();

    const taskName = page.locator('[data-testid^="task-name-"]').first();
    await expect(taskName).toContainText('docs');
    await expect(taskName).toContainText('example.com');
  });
});

test.describe('Markdown shortcuts — image template (Cmd+Shift+I)', () => {
  test('inserts ![alt](url) and selects "alt" placeholder', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+Shift+i');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('My task![alt](url)');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('alt');
  });

  test('Tab jumps from [alt] to select "url" placeholder', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+Shift+i');
    await page.waitForTimeout(50);

    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('My task![alt](url)');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('url');
  });

  test('typing replaces "alt", Tab selects "url", typing replaces "url"', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Meta+Shift+i');
    await page.waitForTimeout(50);

    await page.keyboard.type('screenshot');
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const midState = await getInputState(page);
    expect(midState.text).toBe('My task![screenshot](url)');
    expect(midState.text.slice(midState.selStart, midState.selEnd)).toBe('url');

    await page.keyboard.type('/images/shot.png');

    const finalState = await getInputState(page);
    expect(finalState.text).toBe('My task![screenshot](/images/shot.png)');
  });
});

test.describe('Markdown shortcuts — Tab without template', () => {
  test('Tab inserts indent when no tab-stop is active', async ({ page }) => {
    await addTask(page, 'My task');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('End');
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('My task\t');
  });
});

test.describe('Markdown shortcuts — template mid-text', () => {
  test('link inserted mid-text preserves surrounding content', async ({ page }) => {
    await addTask(page, 'before after');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    // Position cursor between "before " and "after" (after the space)
    await editInput.press('Home');
    for (let i = 0; i < 'before '.length; i++) await editInput.press('ArrowRight');

    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('before [text](url)after');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('text');
  });

  test('Tab-stop works correctly with text after template', async ({ page }) => {
    await addTask(page, 'before after');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    await editInput.press('Home');
    for (let i = 0; i < 'before '.length; i++) await editInput.press('ArrowRight');

    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    await page.keyboard.type('link');
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('before [link](url)after');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('url');
  });
});

test.describe('Markdown shortcuts — multi-line content', () => {
  test('Cmd+K on second line of multi-line task selects "text" correctly', async ({ page }) => {
    await addTask(page, 'Task title\n#tag @tomorrow p3');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    // Move to very start, then End to get end of first line
    await editInput.press('Meta+ArrowUp');
    await editInput.press('End');

    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('Task title[text](url)\n#tag @tomorrow p3');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('text');
  });

  test('Tab-stop works on multi-line content after Cmd+K', async ({ page }) => {
    await addTask(page, 'Task title\n#tag @tomorrow p3');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    // Move to very start, then End to get end of first line
    await editInput.press('Meta+ArrowUp');
    await editInput.press('End');

    await editInput.press('Meta+k');
    await page.waitForTimeout(50);

    await page.keyboard.type('docs');
    await editInput.press('Tab');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('Task title[docs](url)\n#tag @tomorrow p3');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('url');
  });

  test('Cmd+Shift+I on second line selects "alt" correctly', async ({ page }) => {
    await addTask(page, 'Line one\nLine two');
    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    // Move to start of second line then to end
    await editInput.press('End');
    // On multi-line, End goes to end of current line; we want end of last line
    await page.keyboard.press('Meta+ArrowDown'); // go to end of content
    await editInput.press('Meta+Shift+i');
    await page.waitForTimeout(50);

    const state = await getInputState(page);
    expect(state.text).toBe('Line one\nLine two![alt](url)');
    expect(state.text.slice(state.selStart, state.selEnd)).toBe('alt');
  });
});
