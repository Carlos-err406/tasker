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

    // Find the unchecked checkbox input
    const checkboxes = taskItem.locator('input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(2);

    // First checkbox should be unchecked
    await expect(checkboxes.nth(0)).not.toBeChecked();
    // Second checkbox should be checked
    await expect(checkboxes.nth(1)).toBeChecked();

    // Click the first checkbox to toggle it
    await checkboxes.nth(0).click();

    // After toggle, first checkbox should be checked
    await expect(checkboxes.nth(0)).toBeChecked();
  });
});
