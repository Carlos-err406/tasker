import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe("Won't Do Status", () => {
  test('set status to Won\'t Do via context menu', async ({ page }) => {
    await addTask(page, 'Skip this task');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');

    // Hover Set Status submenu
    await page.getByRole('menuitem', { name: /Status/ }).hover();

    // Click Won't Do
    const wontDoItem = page.getByRole('menuitem', { name: "Won't Do" });
    await expect(wontDoItem).toBeVisible();
    await wontDoItem.dispatchEvent('pointerdown');
    await wontDoItem.dispatchEvent('pointerup');
    await wontDoItem.dispatchEvent('click');

    // Checkbox should show X icon (won't do styling)
    const checkbox = page.locator('[data-testid^="task-checkbox-"]').first();
    await expect(checkbox.locator('svg.lucide-x')).toBeVisible();
  });

  test('Won\'t Do status submenu shows all 4 states', async ({ page }) => {
    await addTask(page, 'Status check');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');

    await page.getByRole('menuitem', { name: /Status/ }).hover();

    await expect(page.getByRole('menuitem', { name: 'Pending' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'In Progress' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: "Won't Do" })).toBeVisible();
  });

  test('Won\'t Do task shows strikethrough title', async ({ page }) => {
    await addTask(page, 'Will be skipped');

    // Set to Won't Do via context menu
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: /Status/ }).hover();
    const wontDoItem = page.getByRole('menuitem', { name: "Won't Do" });
    await wontDoItem.dispatchEvent('pointerdown');
    await wontDoItem.dispatchEvent('pointerup');
    await wontDoItem.dispatchEvent('click');

    // Title should have line-through
    const taskName = page.locator('[data-testid^="task-name-"]').first();
    await expect(taskName).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('toggle Won\'t Do back to Pending via checkbox click', async ({ page }) => {
    await addTask(page, 'Toggle wontdo');

    // Set to Won't Do
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: /Status/ }).hover();
    const wontDoItem = page.getByRole('menuitem', { name: "Won't Do" });
    await wontDoItem.dispatchEvent('pointerdown');
    await wontDoItem.dispatchEvent('pointerup');
    await wontDoItem.dispatchEvent('click');

    const checkbox = page.locator('[data-testid^="task-checkbox-"]').first();
    await expect(checkbox.locator('svg.lucide-x')).toBeVisible();

    // Click checkbox to toggle back to Pending
    await checkbox.click();
    await expect(checkbox.locator('svg.lucide-x')).not.toBeVisible();
    await expect(checkbox.locator('svg.lucide-check')).not.toBeVisible();
  });

  test('hide completed also hides Won\'t Do tasks', async ({ page }) => {
    await addTask(page, 'Active task');
    await addTask(page, 'Skipped task');

    // Set second task to Won't Do
    const taskItems = page.locator('[data-testid^="task-item-"]');
    await taskItems.first().click({ button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.getByRole('menuitem', { name: /Status/ }).hover();
    const wontDoItem = page.getByRole('menuitem', { name: "Won't Do" });
    await wontDoItem.dispatchEvent('pointerdown');
    await wontDoItem.dispatchEvent('pointerup');
    await wontDoItem.dispatchEvent('click');

    // Both tasks visible
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);

    // Click hide-completed toggle
    const header = page.locator('[data-testid="list-header-tasks"]');
    const eyeButton = header.locator('button', {
      has: page.locator('svg.lucide-eye, svg.lucide-eye-off'),
    });
    await eyeButton.click();

    // Only the active task should be visible
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
  });
});
