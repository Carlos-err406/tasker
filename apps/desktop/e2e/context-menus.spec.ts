import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Context Menus', () => {
  test('task context menu opens on right-click', async ({ page }) => {
    await addTask(page, 'Right-click me');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();

    // Should have standard menu items
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('Edit option opens inline editor', async ({ page }) => {
    await addTask(page, 'Edit me');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    await expect(page.locator('[data-testid="task-edit-input"]')).toBeVisible();
  });

  test('Set Status submenu shows all 3 states', async ({ page }) => {
    await addTask(page, 'Status test');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');

    // Hover the "Set Status" submenu trigger
    await page.getByRole('menuitem', { name: /Status/ }).hover();

    // Wait for submenu
    await expect(page.getByRole('menuitem', { name: 'Pending' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'In Progress' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Done' })).toBeVisible();
  });

  test('Move to submenu shows available lists', async ({ page }) => {
    // Create a second list first
    await page.locator('[data-testid="new-list-button"]').click();
    const listInput = page.locator('input[placeholder="List name..."]');
    await listInput.fill('work');
    await listInput.press('Enter');

    await addTask(page, 'Move me');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');

    // Hover "Move to..." trigger
    await page.getByRole('menuitem', { name: /Move to/ }).hover();

    // Should see the "work" list (not "tasks" since that's the current list)
    await expect(page.getByRole('menuitem', { name: 'work' })).toBeVisible();
  });

  test('Create subtask stays in editing mode', async ({ page }) => {
    await addTask(page, 'Parent task');

    // Right-click → Create subtask
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: 'Create subtask' }).click();

    // The add input should be visible and editable (not auto-submitted)
    const addInput = page.locator('[data-testid="add-task-input-tasks"]');
    await expect(addInput).toBeVisible();
    await expect(addInput).toBeFocused();

    // Type a subtask name and submit
    // Cursor should be at position 0 (before the metadata line)
    await addInput.pressSequentially('Child task');
    await addInput.press('Meta+Enter');
    await addInput.waitFor({ state: 'hidden' });

    // Should now have 2 tasks: parent and child subtask
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);
    // The child task should be visible
    const taskNames = page.locator('[data-testid^="task-name-"]');
    await expect(taskNames.filter({ hasText: 'Child task' })).toHaveCount(1);
  });

  test('move task to another list', async ({ page }) => {
    // Create second list
    await page.locator('[data-testid="new-list-button"]').click();
    const listInput = page.locator('input[placeholder="List name..."]');
    await listInput.fill('work');
    await listInput.press('Enter');

    await addTask(page, 'Moveable task');

    // Right-click → Move to... → work
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');

    // Hover "Move to..." and wait for submenu to appear
    const moveToTrigger = page.getByRole('menuitem', { name: /Move to/ });
    await moveToTrigger.hover();

    // Click submenu item via Radix data attributes (bypasses pointer-event interception)
    const workItem = page.getByRole('menuitem', { name: 'work' });
    await expect(workItem).toBeVisible();
    // Use dispatchEvent to trigger Radix's onSelect handler
    await workItem.dispatchEvent('pointerdown');
    await workItem.dispatchEvent('pointerup');
    await workItem.dispatchEvent('click');

    // Task should disappear from "tasks" list
    const tasksSection = page.locator('[data-testid="list-section-tasks"]');
    await expect(
      tasksSection.locator('[data-testid^="task-item-"]'),
    ).toHaveCount(0);

    // Task should appear in "work" list
    const workSection = page.locator('[data-testid="list-section-work"]');
    await expect(
      workSection.locator('[data-testid^="task-name-"]').first(),
    ).toHaveText('Moveable task');
  });
});
