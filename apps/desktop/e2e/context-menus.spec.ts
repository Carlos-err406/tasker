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
    await page.getByRole('menuitem', { name: /Move to/ }).hover();
    await page.getByRole('menuitem', { name: 'work' }).click();

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
