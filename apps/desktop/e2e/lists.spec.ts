import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Lists', () => {
  test('create a new list', async ({ page }) => {
    await page.locator('[data-testid="new-list-button"]').click();

    const listInput = page.locator('input[placeholder="List name..."]');
    await expect(listInput).toBeVisible();
    await listInput.fill('work');
    await listInput.press('Enter');

    // New list section should appear
    await expect(page.locator('[data-testid="list-section-work"]')).toBeVisible();
  });

  test('add tasks to different lists', async ({ page }) => {
    // Create a second list
    await page.locator('[data-testid="new-list-button"]').click();
    const listInput = page.locator('input[placeholder="List name..."]');
    await listInput.fill('work');
    await listInput.press('Enter');

    // Add task to default list
    await addTask(page, 'Personal task', 'tasks');
    // Add task to work list
    await addTask(page, 'Work task', 'work');

    // Verify tasks are in correct lists
    const tasksSection = page.locator('[data-testid="list-section-tasks"]');
    await expect(
      tasksSection.locator('[data-testid^="task-name-"]').first(),
    ).toHaveText('Personal task');

    const workSection = page.locator('[data-testid="list-section-work"]');
    await expect(
      workSection.locator('[data-testid^="task-name-"]').first(),
    ).toHaveText('Work task');
  });

  test('collapse and expand a list', async ({ page }) => {
    await addTask(page, 'Visible task');

    // Click collapse toggle
    await page.locator('[data-testid="list-collapse-tasks"]').click();

    // Task should be hidden (inside collapsed container)
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem).not.toBeVisible();

    // Click again to expand
    await page.locator('[data-testid="list-collapse-tasks"]').click();
    await expect(taskItem).toBeVisible();
  });

  test('hide and show completed tasks', async ({ page }) => {
    await addTask(page, 'Pending task');
    await addTask(page, 'Done task');

    // Complete one task
    const checkboxes = page.locator('[data-testid^="task-checkbox-"]');
    await checkboxes.first().click();

    // Both tasks should be visible
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);

    // Click hide-completed toggle (the eye icon)
    const header = page.locator('[data-testid="list-header-tasks"]');
    const eyeButton = header.locator('button', {
      has: page.locator('svg.lucide-eye, svg.lucide-eye-off'),
    });
    await eyeButton.click();

    // Only pending task should be visible
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    // Toggle back
    await eyeButton.click();
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);
  });
});
