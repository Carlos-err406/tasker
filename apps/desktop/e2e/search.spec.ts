import { test, expect } from './fixtures.js';
import { addTask, waitForSearchDebounce } from './helpers.js';

test.describe('Search', () => {
  test('search by text', async ({ page }) => {
    await addTask(page, 'Buy groceries');
    await addTask(page, 'Clean the house');
    await addTask(page, 'Buy a new book');

    const searchInput = page.locator('[data-testid="search-input"]');
    await searchInput.fill('Buy');
    await waitForSearchDebounce(page);

    // Should show 2 matching tasks
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);
  });

  test('search by tag', async ({ page }) => {
    await addTask(page, 'Buy milk #shopping');
    await addTask(page, 'Read a book #learning');

    const searchInput = page.locator('[data-testid="search-input"]');
    await searchInput.fill('tag:shopping');
    await waitForSearchDebounce(page);

    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-name-"]').first()).toHaveText(
      'Buy milk',
    );
  });

  test('clear search shows all tasks', async ({ page }) => {
    await addTask(page, 'Task one');
    await addTask(page, 'Task two');

    const searchInput = page.locator('[data-testid="search-input"]');
    await searchInput.fill('one');
    await waitForSearchDebounce(page);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    // Clear search
    await searchInput.fill('');
    await waitForSearchDebounce(page);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);
  });

  test('no results shows empty state', async ({ page }) => {
    await addTask(page, 'Existing task');

    const searchInput = page.locator('[data-testid="search-input"]');
    await searchInput.fill('nonexistent query');
    await waitForSearchDebounce(page);

    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);
    await expect(page.locator('text=No results')).toBeVisible();
  });
});
