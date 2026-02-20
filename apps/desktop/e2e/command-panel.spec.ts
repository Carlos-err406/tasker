import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

/** Open the command panel in task mode (Cmd+P) */
async function openTaskPanel(page: Parameters<typeof addTask>[0]) {
  await page.keyboard.press('Meta+p');
  await page.waitForSelector('[data-testid="command-panel"]', { timeout: 3000 });
}

/** Open the command panel in command mode (Cmd+Shift+P) */
async function openCommandPanel(page: Parameters<typeof addTask>[0]) {
  await page.keyboard.press('Meta+Shift+p');
  await page.waitForSelector('[data-testid="command-panel"]', { timeout: 3000 });
}

test.describe('Command Panel', () => {
  test('opens in task mode with Cmd+P', async ({ page }) => {
    await openTaskPanel(page);

    const panel = page.locator('[data-testid="command-panel"]');
    await expect(panel).toBeVisible();

    // Input should be empty in task mode
    const input = page.locator('[data-testid="command-panel-input"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('');
  });

  test('opens in command mode with Cmd+Shift+P', async ({ page }) => {
    await openCommandPanel(page);

    const input = page.locator('[data-testid="command-panel-input"]');
    await expect(input).toBeVisible();
    // Input should start with '>' for command mode
    await expect(input).toHaveValue('>');
  });

  test('closes with Escape', async ({ page }) => {
    await openTaskPanel(page);
    await expect(page.locator('[data-testid="command-panel"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();
  });

  test('task mode: shows tasks and filters by query', async ({ page }) => {
    await addTask(page, 'Buy groceries');
    await addTask(page, 'Write report');
    await addTask(page, 'Buy a book');

    await openTaskPanel(page);
    const input = page.locator('[data-testid="command-panel-input"]');

    // All tasks should be shown initially
    const taskGroup = page.locator('[data-testid="command-panel-tasks-group"]');
    await expect(taskGroup).toBeVisible();

    // Filter by 'Buy'
    await input.fill('Buy');
    await page.waitForTimeout(100);

    const taskItems = page.locator('[data-testid^="command-panel-task-"]');
    await expect(taskItems).toHaveCount(2);
  });

  test('task mode: navigates to task on selection', async ({ page }) => {
    await addTask(page, 'Navigate to me');

    await openTaskPanel(page);

    // Click the task in the panel
    const taskItem = page.locator('[data-testid^="command-panel-task-"]').first();
    await taskItem.click();
    await page.waitForTimeout(300);

    // Panel should close
    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();
  });

  test('typing > switches to command mode', async ({ page }) => {
    await openTaskPanel(page);

    const input = page.locator('[data-testid="command-panel-input"]');
    await input.fill('>');
    await page.waitForTimeout(100);

    // Command mode commands should now be visible
    const undoCmd = page.locator('[data-testid="command-panel-cmd-undo"]');
    await expect(undoCmd).toBeVisible();
  });

  test('command mode: shows immediate commands', async ({ page }) => {
    await openCommandPanel(page);

    // Undo/Redo should be present
    await expect(page.locator('[data-testid="command-panel-cmd-undo"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-panel-cmd-redo"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-panel-cmd-refresh"]')).toBeVisible();
  });

  test('command mode: filters commands by query', async ({ page }) => {
    await openCommandPanel(page);

    const input = page.locator('[data-testid="command-panel-input"]');
    await input.fill('> undo');
    await page.waitForTimeout(100);

    // Only undo should be visible (redo doesn't match 'undo')
    await expect(page.locator('[data-testid="command-panel-cmd-undo"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-panel-cmd-redo"]')).not.toBeVisible();
  });

  test('command mode: set status transitions to task select then sub-pick', async ({ page }) => {
    await addTask(page, 'Status target task');
    await openCommandPanel(page);

    // Click 'Set status'
    const setStatus = page.locator('[data-testid="command-panel-cmd-set-status"]');
    await setStatus.click();
    await page.waitForTimeout(100);

    // Should now show task select step
    const taskSelect = page.locator('[data-testid="command-panel-step-task-select"]');
    await expect(taskSelect).toBeVisible();

    // Select the task
    const taskItem = page.locator('[data-testid^="command-panel-task-"]').first();
    await taskItem.click();
    await page.waitForTimeout(100);

    // Should now show sub-pick (status options)
    const subPick = page.locator('[data-testid="command-panel-step-sub-pick"]');
    await expect(subPick).toBeVisible();

    // Status options should be visible
    await expect(page.locator('[data-testid^="command-panel-subopt-"]')).toHaveCount(3);
  });

  test('command mode: undo executes and closes panel', async ({ page }) => {
    await addTask(page, 'Task to undo');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    await openCommandPanel(page);
    await page.locator('[data-testid="command-panel-cmd-undo"]').click();
    await page.waitForTimeout(300);

    // Panel should close
    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();

    // Task should be gone (undo removed the creation)
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);
  });
});
