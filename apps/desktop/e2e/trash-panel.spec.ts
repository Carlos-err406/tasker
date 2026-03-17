import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Trash Panel', () => {
  test('trash icon opens trash panel', async ({ page }) => {
    // Click trash icon in header
    const trashButton = page.locator('[data-testid="trash-button"]');
    await trashButton.click();

    await expect(page.locator('[data-testid="trash-panel"]')).toBeVisible();
    await expect(page.getByText('Trash is empty')).toBeVisible();
  });

  test('deleted task appears in trash panel', async ({ page }) => {
    await addTask(page, 'Task to trash');

    // Delete via context menu
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);

    // Open trash panel
    const trashButton = page.locator('[data-testid="trash-button"]');
    await trashButton.click();

    await expect(page.locator('[data-testid="trash-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid^="trash-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="trash-item-"]').first()).toContainText('Task to trash');
  });

  test('restore task from trash', async ({ page }) => {
    await addTask(page, 'Restore me');

    // Delete the task
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);

    // Open trash, click restore
    const trashButton = page.locator('[data-testid="trash-button"]');
    await trashButton.click();

    const restoreButton = page.locator('[data-testid^="trash-item-"]').first().locator('button');
    await restoreButton.click();

    // Trash should be empty now
    await expect(page.getByText('Trash is empty')).toBeVisible();

    // Go back to main view
    const backButton = page.locator('[data-testid="trash-panel"] button', {
      has: page.locator('svg.lucide-arrow-left'),
    });
    await backButton.click();

    // Task should be restored
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-name-"]').first()).toHaveText('Restore me');
  });

  test('back button returns to main view', async ({ page }) => {
    // Open trash
    const trashButton = page.locator('[data-testid="trash-button"]');
    await trashButton.click();
    await expect(page.locator('[data-testid="trash-panel"]')).toBeVisible();

    // Click back
    const backButton = page.locator('[data-testid="trash-panel"] button', {
      has: page.locator('svg.lucide-arrow-left'),
    });
    await backButton.click();

    // Should be back to main content
    await expect(page.locator('[data-testid="trash-panel"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="app-content"]')).toBeVisible();
  });

  test('trash panel shows item count', async ({ page }) => {
    await addTask(page, 'First');
    await addTask(page, 'Second');

    // Delete both tasks
    for (let i = 0; i < 2; i++) {
      const taskItem = page.locator('[data-testid^="task-item-"]').first();
      await taskItem.click({ button: 'right' });
      await page.waitForSelector('[role="menu"]');
      await page.getByRole('menuitem', { name: 'Delete' }).click();
    }

    // Open trash
    const trashButton = page.locator('[data-testid="trash-button"]');
    await trashButton.click();

    await expect(page.locator('[data-testid="trash-panel"]')).toContainText('2 items');
    await expect(page.locator('[data-testid^="trash-item-"]')).toHaveCount(2);
  });
});
