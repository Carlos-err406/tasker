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

  test('rename a list from the list menu', async ({ page }) => {
    await page.locator('[data-testid="new-list-button"]').click();
    const listInput = page.locator('input[placeholder="List name..."]');
    await listInput.fill('work');
    await listInput.press('Enter');

    const header = page.locator('[data-testid="list-header-work"]');
    await header.locator('button', { has: page.locator('svg.lucide-ellipsis') }).click();

    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible' });
    await menu.getByRole('menuitem', { name: 'Rename' }).click();
    await page.waitForTimeout(300);

    const nameInput = page.locator('[data-testid="list-name-input-work"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeFocused();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('projects');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-testid="list-section-projects"]')).toBeVisible();
    await expect(page.locator('[data-testid="list-section-work"]')).toHaveCount(0);
  });

  test('collapse and expand a list', async ({ page }) => {
    await addTask(page, 'Visible task');

    // Click collapse toggle
    await page.locator('[data-testid="list-collapse-tasks"]').click();

    // The task is inside an overflow-hidden container with grid-template-rows: 0fr
    // Browser computes 0fr as 0px
    const gridContainer = page.locator('[data-testid="list-section-tasks"] .grid');
    await expect(gridContainer).toHaveCSS('grid-template-rows', '0px');

    // Click again to expand
    await page.locator('[data-testid="list-collapse-tasks"]').click();

    // After expand, grid-template-rows should be 1fr (or a specific pixel value)
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem).toBeVisible();
  });

  test('reset list filter when deleting last task in filtered list', async ({ page }) => {
    // Create a second list with a task
    await page.locator('[data-testid="new-list-button"]').click();
    const listInput = page.locator('input[placeholder="List name..."]');
    await listInput.fill('work');
    await listInput.press('Enter');
    await addTask(page, 'Work task', 'work');

    // Add a task to default list too
    await addTask(page, 'Default task', 'tasks');

    // Filter to the "work" list
    await page.locator('[data-testid="filter-dropdown-toggle"]').click();
    await page.locator('[data-testid="filter-option-work"]').click();

    // Verify filter is active — only work tasks shown
    await expect(page.locator('[data-testid="filter-dropdown-toggle"]')).toHaveText(/work/);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    // Delete the only task in the work list via context menu
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible' });
    await menu.getByRole('menuitem', { name: 'Delete' }).dispatchEvent('click');

    // Filter should reset to "All Lists" and show all remaining tasks
    await expect(page.locator('[data-testid="filter-dropdown-toggle"]')).toHaveText(/All Lists/);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="task-name-"]').first()).toHaveText('Default task');
  });

  test('reset list filter when deleting a task in a non-empty filtered list', async ({ page }) => {
    await page.locator('[data-testid="new-list-button"]').click();
    const listInput = page.locator('input[placeholder="List name..."]');
    await listInput.fill('work');
    await listInput.press('Enter');

    await addTask(page, 'First work task', 'work');
    await addTask(page, 'Second work task', 'work');
    await addTask(page, 'Default task', 'tasks');

    await page.locator('[data-testid="filter-dropdown-toggle"]').click();
    await page.locator('[data-testid="filter-option-work"]').click();

    await expect(page.locator('[data-testid="filter-dropdown-toggle"]')).toHaveText(/work/);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);

    const taskItem = page.locator('[data-testid^="task-item-"]', { hasText: 'First work task' });
    await taskItem.click({ button: 'right' });
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible' });
    await menu.getByRole('menuitem', { name: 'Delete' }).dispatchEvent('click');

    await expect(page.locator('[data-testid="filter-dropdown-toggle"]')).toHaveText(/All Lists/);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);
    await expect(page.getByText('Second work task')).toBeVisible();
    await expect(page.getByText('Default task')).toBeVisible();
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
