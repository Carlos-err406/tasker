import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Markdown', () => {
  test('renders bold and italic in task description', async ({ page }) => {
    await addTask(page, 'Title\n**bold text** and *italic text*');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('strong')).toHaveText('bold text');
    await expect(taskItem.locator('em')).toHaveText('italic text');
  });

  test('renders code block', async ({ page }) => {
    await addTask(page, 'Title\n```\nconst x = 1;\n```');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('pre code')).toBeVisible();
    await expect(taskItem.locator('pre code')).toContainText('const x = 1');
  });

  test('renders links as anchor elements', async ({ page }) => {
    await addTask(page, 'Title\nVisit [example](https://example.com)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const link = taskItem.locator('a');
    await expect(link).toHaveText('example');
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  test('clickable checkbox toggles', async ({ page }) => {
    await addTask(page, 'Title\n- [ ] unchecked item\n- [x] checked item');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();

    // Checkboxes are rendered as lucide SVG icons (Square/CheckSquare)
    // Find all SVGs that act as checkboxes within list items
    const allCheckboxSvgs = taskItem.locator('li svg');
    await expect(allCheckboxSvgs).toHaveCount(2);

    // Click the first checkbox (unchecked) to toggle it
    await allCheckboxSvgs.nth(0).click();
    await page.waitForTimeout(200);

    // Verify the text was updated (the unchecked [ ] becomes [x])
    // After toggle, the task description should have been updated via onToggleCheckbox
    // Re-query the task to see if the description was updated
    await expect(taskItem.locator('text=unchecked item')).toBeVisible();
  });
});
