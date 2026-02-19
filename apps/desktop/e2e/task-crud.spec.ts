import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Task CRUD', () => {
  test('add a task', async ({ page }) => {
    await addTask(page, 'Buy groceries');

    const taskName = page.locator('[data-testid^="task-name-"]').first();
    await expect(taskName).toHaveText('Buy groceries');
  });

  test('add a task with inline metadata', async ({ page }) => {
    await addTask(page, 'Buy milk @due:2026-03-01 #shopping priority:high');

    // Verify task appears with metadata rendered
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem).toBeVisible();

    // Priority indicator should be visible (high = !!!)
    await expect(taskItem.locator('text=!!!')).toBeVisible();

    // Tag pill should render
    await expect(taskItem.locator('text=shopping')).toBeVisible();

    // Due date badge should render
    await expect(taskItem.locator('text=/Mar/')).toBeVisible();
  });

  test('edit/rename a task via context menu', async ({ page }) => {
    await addTask(page, 'Original task name');

    // Right-click the task
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });

    // Wait for context menu and click Edit
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    // Modify text in the edit input
    const editInput = page.locator('[data-testid="task-edit-input"]');
    await expect(editInput).toBeVisible();
    await editInput.fill('Updated task name');
    await editInput.press('Meta+Enter');

    // Verify updated
    await expect(page.locator('[data-testid^="task-name-"]').first()).toHaveText(
      'Updated task name',
    );
  });

  test('cancel edit with Escape', async ({ page }) => {
    await addTask(page, 'Keep this name');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    const editInput = page.locator('[data-testid="task-edit-input"]');
    await editInput.fill('Changed name');
    await editInput.press('Escape');

    // Original name should be preserved
    await expect(page.locator('[data-testid^="task-name-"]').first()).toHaveText(
      'Keep this name',
    );
  });

  test('complete a task by clicking checkbox', async ({ page }) => {
    await addTask(page, 'Task to complete');

    const checkbox = page.locator('[data-testid^="task-checkbox-"]').first();
    await checkbox.click();

    // Checkbox should show checkmark (green check icon)
    await expect(checkbox.locator('svg.lucide-check')).toBeVisible();
  });

  test('uncomplete a done task', async ({ page }) => {
    await addTask(page, 'Task to toggle');

    const checkbox = page.locator('[data-testid^="task-checkbox-"]').first();

    // Complete
    await checkbox.click();
    await expect(checkbox.locator('svg.lucide-check')).toBeVisible();

    // Uncomplete
    await checkbox.click();
    await expect(checkbox.locator('svg.lucide-check')).not.toBeVisible();
  });

  test('delete a task via context menu', async ({ page }) => {
    await addTask(page, 'Task to delete');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);
  });
});
