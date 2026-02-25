import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

/** Helper: extract shortId from a task item's data-testid attribute */
async function getShortId(locator: import('@playwright/test').Locator): Promise<string> {
  const testId = await locator.getAttribute('data-testid');
  return testId!.replace('task-item-', '');
}

test.describe('Metadata autocomplete — add-task input', () => {
  test('click: replaces partial with task ID', async ({ page }) => {
    await addTask(page, 'Fix the login bug');
    const targetShortId = await getShortId(page.locator('[data-testid^="task-item-"]').first());

    const header = page.locator('[data-testid="list-header-tasks"]');
    await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();
    const input = page.locator('[data-testid="add-task-input-tasks"]');
    await input.waitFor({ state: 'visible' });
    await input.click();

    await page.keyboard.type('Depends on ~Fix');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText('Fix the login bug')).toBeVisible();

    await dropdown.locator('button').filter({ hasText: 'Fix the login bug' }).click();

    // "~Fix" must be replaced by the real shortId — not left as "~<id>Fix"
    await expect(input).toContainText(`~${targetShortId}`);
    await expect(input).not.toContainText('~Fix');
    await expect(dropdown).not.toBeVisible();
  });

  test('click: short 2-char partial is fully replaced (regression for ~70sck bug)', async ({ page }) => {
    // Create tasks whose titles contain the partial "ck" but whose shortIds differ
    await addTask(page, 'Unlock the door');
    await addTask(page, 'Check settings');
    const items = page.locator('[data-testid^="task-item-"]');
    // Wait for "Check settings" to appear as the first item (newest first)
    await expect(items.first()).toContainText('Check settings');
    const checkShortId = await getShortId(items.first());

    const header = page.locator('[data-testid="list-header-tasks"]');
    await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();
    const input = page.locator('[data-testid="add-task-input-tasks"]');
    await input.waitFor({ state: 'visible' });
    await input.click();

    // Type the short partial that caused the race condition bug
    await page.keyboard.type('New task ~ck');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Click "Check settings" (the first item that contains "ck")
    await dropdown.locator('button').filter({ hasText: 'Check settings' }).click();

    // The partial "ck" must be fully removed — not left behind as "~<id>ck"
    await expect(input).toContainText(`~${checkShortId}`);
    const text = await input.innerText();
    expect(text).not.toMatch(/~\w+ck/); // shortId must not be followed by the leftover partial
    await expect(dropdown).not.toBeVisible();
  });

  test('keyboard: ArrowDown + Enter selects item', async ({ page }) => {
    await addTask(page, 'Alpha task');
    await addTask(page, 'Beta task');
    const items = page.locator('[data-testid^="task-item-"]');
    // List newest-first: "Beta task" is first, "Alpha task" is second
    const alphaShortId = await getShortId(items.nth(1));

    const header = page.locator('[data-testid="list-header-tasks"]');
    await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();
    const input = page.locator('[data-testid="add-task-input-tasks"]');
    await input.waitFor({ state: 'visible' });
    await input.click();

    await page.keyboard.type('~');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Navigate down to the second item (Alpha task) and accept with Enter
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(input).toContainText(`~${alphaShortId}`);
    await expect(dropdown).not.toBeVisible();
  });

  test('keyboard: Escape dismisses dropdown without changing input', async ({ page }) => {
    await addTask(page, 'Fix the login bug');

    const header = page.locator('[data-testid="list-header-tasks"]');
    await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();
    const input = page.locator('[data-testid="add-task-input-tasks"]');
    await input.waitFor({ state: 'visible' });
    await input.click();

    await page.keyboard.type('New task ~Fix');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Escape should close the dropdown and leave the typed text unchanged
    await page.keyboard.press('Escape');
    await expect(dropdown).not.toBeVisible();
    await expect(input).toContainText('~Fix');

    // Input should still be open (Escape only dismissed autocomplete, not the add form)
    await expect(input).toBeVisible();
  });

  test('^ prefix (parent) replaces partial correctly', async ({ page }) => {
    await addTask(page, 'Parent feature');
    const targetShortId = await getShortId(page.locator('[data-testid^="task-item-"]').first());

    const header = page.locator('[data-testid="list-header-tasks"]');
    await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();
    const input = page.locator('[data-testid="add-task-input-tasks"]');
    await input.waitFor({ state: 'visible' });
    await input.click();

    await page.keyboard.type('Subtask ^Parent');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText('Parent feature')).toBeVisible();

    await dropdown.locator('button').filter({ hasText: 'Parent feature' }).click();

    await expect(input).toContainText(`^${targetShortId}`);
    await expect(input).not.toContainText('^Parent');
    await expect(dropdown).not.toBeVisible();
  });
});

test.describe('Metadata autocomplete — task edit input', () => {
  /**
   * startEdit() uses setTimeout(50ms) to focus the div and fill it with text.
   * If we type before the timeout fires it overwrites our input mid-stream.
   * Waiting for the div to be non-empty ensures the timeout has completed and
   * the input is focused before we start typing.
   */
  async function openEdit(page: import('@playwright/test').Page, itemLocator: import('@playwright/test').Locator) {
    await itemLocator.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const editInput = page.locator('[data-testid="task-edit-input"]');
    await expect(editInput).toBeVisible();
    // Wait for the 50ms timeout to fill the div with the task description and focus it
    await expect(editInput).not.toBeEmpty();
    return editInput;
  }

  test('click: replaces partial with task ID', async ({ page }) => {
    await addTask(page, 'Fix the login bug');
    await addTask(page, 'Main feature');

    // "Main feature" is newest → first; "Fix the login bug" is second
    const items = page.locator('[data-testid^="task-item-"]');
    const fixShortId = await getShortId(items.nth(1));

    const editInput = await openEdit(page, items.first());

    // Cursor is already at the end — type without clicking first
    await page.keyboard.type(' ~Fix');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText('Fix the login bug')).toBeVisible();

    await dropdown.locator('button').filter({ hasText: 'Fix the login bug' }).click();

    await expect(editInput).toContainText(`~${fixShortId}`);
    await expect(editInput).not.toContainText('~Fix');
    await expect(dropdown).not.toBeVisible();

    await editInput.press('Meta+Enter');
    await expect(editInput).not.toBeVisible();
  });

  test('keyboard: Tab selects highlighted item', async ({ page }) => {
    await addTask(page, 'Backend service');
    await addTask(page, 'Frontend work');

    const items = page.locator('[data-testid^="task-item-"]');
    // "Frontend work" is newest → first; "Backend service" is second
    const backendShortId = await getShortId(items.nth(1));

    const editInput = await openEdit(page, items.first());

    // Type just "~" (no partial) so the dropdown opens with all tasks.
    // Avoids the race where the dropdown appears with a short partial before the
    // full partial's detect has settled.
    await page.keyboard.type(' ~');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Navigate down to "Backend service" (second item, since "Frontend work" is excluded
    // from its own edit input via excludeTaskId)
    await editInput.press('ArrowDown');

    // Tab should accept the highlighted item
    await editInput.press('Tab');

    await expect(editInput).toContainText(`~${backendShortId}`);
    await expect(dropdown).not.toBeVisible();

    await editInput.press('Meta+Enter');
    await expect(editInput).not.toBeVisible();
  });

  test('keyboard: Escape dismisses dropdown, second Escape closes editor', async ({ page }) => {
    await addTask(page, 'Fix the login bug');
    await addTask(page, 'Main feature');

    const items = page.locator('[data-testid^="task-item-"]');
    const editInput = await openEdit(page, items.first());

    // Type just "~" to trigger autocomplete without partial race
    await page.keyboard.type(' ~');

    const dropdown = page.locator('[data-testid="metadata-autocomplete-dropdown"]');
    await expect(dropdown).toBeVisible();

    // First Escape: close dropdown, keep editor open
    await editInput.press('Escape');
    await expect(dropdown).not.toBeVisible();
    await expect(editInput).toBeVisible();

    // Second Escape: close editor
    await editInput.press('Escape');
    await expect(editInput).not.toBeVisible();
  });
});
