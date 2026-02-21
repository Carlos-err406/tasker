import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Undo/Redo', () => {
  test('undo task creation', async ({ page }) => {
    await addTask(page, 'Temporary task');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    // Undo
    await page.keyboard.press('Meta+z');

    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);

    // Status bar should show undo message (check immediately — 3s timeout clears it)
    const statusBar = page.locator('[data-testid="status-bar"]');
    await expect(statusBar).toContainText(/[Uu]ndo/);
  });

  test('redo after undo', async ({ page }) => {
    await addTask(page, 'Redo test task');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    // Undo
    await page.keyboard.press('Meta+z');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);

    // Redo
    await page.keyboard.press('Meta+Shift+z');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
  });

  test('undo status change', async ({ page }) => {
    await addTask(page, 'Status undo test');

    // Complete the task
    const checkbox = page.locator('[data-testid^="task-checkbox-"]').first();
    await checkbox.click();
    await expect(checkbox.locator('svg.lucide-check')).toBeVisible();

    // Undo should revert to pending
    await page.keyboard.press('Meta+z');
    await expect(checkbox.locator('svg.lucide-check')).not.toBeVisible();
  });

  test('empty undo stack shows nothing to undo', async ({ page }) => {
    // Press Cmd+Z with nothing to undo
    await page.keyboard.press('Meta+z');

    const statusBar = page.locator('[data-testid="status-bar"]');
    await expect(statusBar).toContainText(/[Nn]othing to undo/);
  });

  test('new action clears redo stack', async ({ page }) => {
    await addTask(page, 'First task');

    // Undo
    await page.keyboard.press('Meta+z');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);

    // New action (add another task) should clear the redo stack
    await addTask(page, 'Second task');

    // Redo should do nothing (stack was cleared)
    await page.keyboard.press('Meta+Shift+z');

    // Should only have the second task
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-name-"]').first()).toHaveText(
      'Second task',
    );
  });
});
